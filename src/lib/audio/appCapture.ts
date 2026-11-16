/**
 * The page's capture — with `appAudio.ts`, the only modules in `src/lib/audio`
 * that read the stores. Opens each leg's source for the platform, feeds the
 * microphone into playback's passthrough route and both legs into the echo
 * watch, and reads the settings the sources follow, live, from `audioStore`.
 */
import type { LegName } from '../conversation/types';
import type { Platform } from '../provider/types';
import { participantSpeechHeard } from '../modern-audio/participantSource';
import type { OpenSource, Source } from '../session/source';
import useAudioStore from '../../stores/audioStore';
import { useRoutingStore } from '../../stores/routingStore';
import { getEnvironment } from '../../utils/environment';
import { createEchoWatch, type EchoWatch } from './capture/echoWatch';
import { openMic, type MicSettings } from './capture/mic';
import { openSystemAudio, type SystemAudioSettings } from './capture/systemAudio';
import { openTab, type TabSettings } from './capture/tab';
import { createLevelMeter, type LevelMeter } from './levelMeter';
import type { Playback } from './playback';
import { targetTabIdFromSearch } from './tabMicrophone';

export interface AppCapture {
  openSource: OpenSource;
  /** For the echo notice (plan 1d): `useEchoNotice`'s one-listener contract. */
  echo: EchoWatch;
  /** Each leg's input spectrum for the footer's waveform: the output strip's frequency bars, over the chunks it delivers while `meterGate` lets them through. */
  levels: Readonly<Record<LegName, LevelMeter>>;
}

const audio = () => useAudioStore.getState();
const onAudioChange = (listener: () => void) => useAudioStore.subscribe(() => listener());

export function micSettings(): MicSettings {
  return {
    deviceId: () => audio().selectedInputDevice?.deviceId,
    deviceLabel: () => audio().selectedInputDevice?.label,
    isListed: (id) => audio().audioInputDevices.some((device) => device.deviceId === id),
    isUnusable: (id) => audio().unusableInputIds.includes(id),
    markUnusable: (id) => audio().markInputUnusable(id),
    noiseSuppression: () => audio().noiseSuppressionMode,
    muted: () => audio().isMicMuted,
    subscribe: onAudioChange,
  };
}

export function systemAudioSettings(): SystemAudioSettings {
  return {
    sourceId: () => audio().selectedParticipantSource?.deviceId ?? 'desktop-audio-loopback',
    muted: () => audio().isParticipantMuted,
    subscribe: onAudioChange,
    audioSeen: () => audio().markParticipantTapAudioSeen(),
  };
}

export function tabSettings(): TabSettings {
  return {
    tabId: () => targetTabIdFromSearch(window.location.search),
    outputDeviceId: () => audio().selectedMonitorDevice?.deviceId,
    muted: () => audio().isParticipantMuted,
  };
}

/** The source, with `cleanup` run once before it stops. */
function withCleanup(source: Source, cleanup: () => void): Source {
  let cleaned = false;
  return {
    onPcm: (listener) => source.onPcm(listener),
    onEnded: (listener) => source.onEnded(listener),
    onDegraded: (listener) => source.onDegraded(listener),
    async stop() {
      if (!cleaned) {
        cleaned = true;
        cleanup();
      }
      await source.stop();
    },
  };
}

export interface AppCaptureOptions {
  /** Checked per chunk: false, and the leg's meter reads flat. Absent: every chunk moves it. */
  meterGate?(leg: LegName): boolean;
}

/**
 * Big Sur spoken-interview guard.
 *
 * An isolated BlackHole input prevents the participant's translation from
 * re-entering participant capture, but it does not prevent that same spoken
 * translation from leaking into the *microphone* (including through the
 * headset path, a selected built-in mic, or a buggy OS route). In that case
 * Sokuji recognises its own Russian TTS as "Me" and sends an English echo
 * back to the meeting.
 *
 * The participant's playback queue is the authoritative signal that Sokuji
 * itself is speaking. Hold microphone frames while the queue is active and
 * briefly afterward for output latency + the tail of room/headset echo.
 *
 * This trades full-duplex overlap for a stable interpreter conversation:
 * the user cannot talk over the Russian interpretation. It never mutes the
 * participant source itself and is inactive with participant speech off.
 */
export const PARTICIPANT_MIC_GUARD_TAIL_MS = 850;

export function participantMicGate(
  playback: Pick<Playback, 'queues'>,
  platform: Platform,
  now: () => number = Date.now,
): () => boolean {
  let untilMs = 0;
  return () => {
    const selected = audio().selectedParticipantSource?.deviceId;
    const voicing = platform === 'electron'
      && useRoutingStore.getState().participantSpeech
      && participantSpeechHeard(platform, selected);
    if (!voicing) {
      untilMs = 0;
      return false;
    }
    const current = now();
    if (playback.queues.participant.pending > 0) {
      untilMs = current + PARTICIPANT_MIC_GUARD_TAIL_MS;
      return true;
    }
    return current < untilMs;
  };
}

export function createAppCapture(playback: Playback, platform: Platform = getEnvironment(), options: AppCaptureOptions = {}): AppCapture {
  const { meterGate } = options;
  const echo = createEchoWatch(playback.ttsTap);
  const blockMicWhileParticipantSpeaks = participantMicGate(playback, platform);
  const levels: Record<LegName, LevelMeter> = { speaker: createLevelMeter(), participant: createLevelMeter() };

  const open = (leg: LegName, signal: AbortSignal): Promise<Source> => {
    if (leg === 'speaker') {
      const settings = micSettings();
      return openMic({ ...settings, muted: () => settings.muted() || blockMicWhileParticipantSpeaks() }, signal);
    }
    if (platform === 'electron') return openSystemAudio(systemAudioSettings(), signal);
    if (platform === 'extension') return openTab(tabSettings(), signal);
    return Promise.reject(new Error('This build has no participant source.'));
  };

  return {
    echo,
    levels,
    async openSource(leg, signal) {
      const source = await open(leg, signal);
      // The processed microphone is the original voice under the translation.
      const offPassthrough = leg === 'speaker' ? source.onPcm((pcm) => playback.passthrough(pcm)) : () => {};
      // A gate that shuts flattens the meter at its next chunk, not a stale
      // spell later: reset once on the way in, never per chunk.
      let metering = true;
      const offLevel = source.onPcm((pcm) => {
        if (!meterGate || meterGate(leg)) {
          metering = true;
          levels[leg].push(pcm);
        } else if (metering) {
          metering = false;
          levels[leg].reset();
        }
      });
      const detach = echo.attach(leg, source);
      return withCleanup(source, () => {
        offPassthrough();
        offLevel();
        levels[leg].reset();
        detach();
      });
    },
  };
}
