/**
 * The two routing switches that did not exist before plan 1c-2 (spec:
 * "Playback" → "Routing"): whether the meeting hears the speaker's
 * translation (on by default), and the participant-TTS opt-in (off). The
 * monitor switch and passthrough stay in `audioStore`, where they live today.
 */
import { create } from 'zustand';
import { persistSetting } from '../services/persistSetting';
import { ServiceFactory } from '../services/ServiceFactory';

const MEETING = 'settings.routing.meeting';
const PARTICIPANT_SPEECH = 'settings.routing.participantSpeech';

/**
 * Whether the participant-speech switch shows. The owner's choice of
 * Upstream keeps this hidden because whole-system capture can recapture
 * translated participant audio. The Big Sur compatibility build exposes it:
 * participantSpeechHeard() still disables playback for whole-system capture,
 * while isolated BlackHole/legacy-input sources are safe and can speak the
 * translated participant audio on the real output device.
 */
export const PARTICIPANT_SPEECH_SHOWN = true;

interface RoutingStore {
  meeting: boolean;
  participantSpeech: boolean;
  load(): Promise<void>;
  setMeeting(on: boolean): void;
  setParticipantSpeech(on: boolean): void;
}

export const useRoutingStore = create<RoutingStore>()((set) => ({
  meeting: true,
  participantSpeech: false,
  async load() {
    const settings = ServiceFactory.getSettingsService();
    const [meeting, participantSpeech] = await Promise.all([
      settings.getSetting(MEETING, true),
      PARTICIPANT_SPEECH_SHOWN ? settings.getSetting(PARTICIPANT_SPEECH, false) : false,
    ]);
    set({
      meeting: typeof meeting === 'boolean' ? meeting : true,
      participantSpeech: typeof participantSpeech === 'boolean' ? participantSpeech : false,
    });
  },
  setMeeting(on) {
    set({ meeting: on });
    void persistSetting(MEETING, on);
  },
  setParticipantSpeech(on) {
    set({ participantSpeech: on });
    void persistSetting(PARTICIPANT_SPEECH, on);
  },
}));
