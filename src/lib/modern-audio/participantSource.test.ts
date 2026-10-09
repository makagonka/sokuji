import { describe, it, expect } from 'vitest';
import { resolveParticipantSourceId, isApplicationSource, isLegacyDeviceSource, needsLoopbackStream, SYSTEM_PARTICIPANT_SOURCE_ID } from './participantSource';

describe('resolveParticipantSourceId', () => {
  it('returns the selected application source id', () => {
    expect(resolveParticipantSourceId({ deviceId: 'app:pid:42', label: 'Zoom' }))
      .toBe('app:pid:42');
  });

  it('returns the whole-system id when the system source is selected', () => {
    expect(resolveParticipantSourceId({ deviceId: SYSTEM_PARTICIPANT_SOURCE_ID, label: 'System Audio' }))
      .toBe(SYSTEM_PARTICIPANT_SOURCE_ID);
  });

  it('falls back to whole-system capture when nothing is selected', () => {
    expect(resolveParticipantSourceId(null)).toBe(SYSTEM_PARTICIPANT_SOURCE_ID);
    expect(resolveParticipantSourceId(undefined)).toBe(SYSTEM_PARTICIPANT_SOURCE_ID);
  });

  it('falls back when the selection carries no deviceId', () => {
    expect(resolveParticipantSourceId({ deviceId: '', label: 'broken' }))
      .toBe(SYSTEM_PARTICIPANT_SOURCE_ID);
  });
});

// Regression guard (issue #335): selecting an application on macOS aborted the
// session. The whole-system loopback gate ran first, asked for a getDisplayMedia
// stream, hit the Screen Recording denial and skipped participant audio -
// even though per-application capture never touches getDisplayMedia.
describe('isApplicationSource', () => {
  it('recognises an application source', () => {
    expect(isApplicationSource('app:pid:3940')).toBe(true);
    expect(isApplicationSource('app:205')).toBe(true);
  });

  it('does not treat whole-system capture as an application', () => {
    expect(isApplicationSource(SYSTEM_PARTICIPANT_SOURCE_ID)).toBe(false);
  });

  it('handles absent and malformed ids', () => {
    expect(isApplicationSource(null)).toBe(false);
    expect(isApplicationSource(undefined)).toBe(false);
    expect(isApplicationSource('')).toBe(false);
    // A device whose label merely mentions an app is not an app source.
    expect(isApplicationSource('some-application-device')).toBe(false);
  });
});

describe('isLegacyDeviceSource', () => {
  it('recognises Big Sur isolated virtual-input capture', () => {
    expect(isLegacyDeviceSource('legacy-input:BlackHole 2ch')).toBe(true);
    expect(isLegacyDeviceSource(SYSTEM_PARTICIPANT_SOURCE_ID)).toBe(false);
    expect(isLegacyDeviceSource('app:42')).toBe(false);
  });
});

// Big Sur compatibility build: whole-system capture falls back to
// getDisplayMedia/electron-audio-loopback, while legacy virtual inputs are
// ordinary isolated audio-input devices and do not need Screen Recording.
describe('needsLoopbackStream', () => {
  // getOperatingSystem() reads navigator.platform, not the user agent.
  const setPlatform = (platform: string) => {
    Object.defineProperty(globalThis.navigator, 'platform', { value: platform, configurable: true });
  };

  it('never needs a loopback stream for an application source', () => {
    setPlatform('Win32');
    expect(needsLoopbackStream('app:pid:42')).toBe(false);
  });

  it('needs one for whole-system capture on Windows', () => {
    setPlatform('Win32');
    expect(needsLoopbackStream(SYSTEM_PARTICIPANT_SOURCE_ID)).toBe(true);
  });

  it('needs one for whole-system capture on macOS Big Sur', () => {
    setPlatform('MacIntel');
    expect(needsLoopbackStream(SYSTEM_PARTICIPANT_SOURCE_ID)).toBe(true);
  });

  it('does not need loopback for an isolated Big Sur virtual input', () => {
    setPlatform('MacIntel');
    expect(needsLoopbackStream('legacy-input:BlackHole 2ch')).toBe(false);
  });
});
