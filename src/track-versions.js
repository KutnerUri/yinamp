export function cleanVersions(value) {
  const versions = {};
  for (const mode of ['song', 'video']) {
    const item = value?.[mode];
    if (/^[\w-]{11}$/.test(item?.id ?? '')) versions[mode] = {
      id: item.id,
      duration: Number.isFinite(item.duration) ? Math.max(0, Math.min(604800, item.duration)) : 0,
    };
  }
  if (versions.song?.id === versions.video?.id) delete versions.video;
  return versions;
}

export function playbackTrack(track, mode, start) {
  if (!track) return null;
  const version = cleanVersions(track.versions)[mode];
  return { ...track, id: version?.id ?? track.id, duration: version?.duration ?? track.duration,
    start: start ?? track.start ?? 0 };
}

export function versionMode(track, playingId) {
  return ['song', 'video'].find(mode => track?.versions?.[mode]?.id === playingId) ?? null;
}

export function recordingControl(track, preference, { checking = false, switching = false, runningVideo = false } = {}) {
  return {
    pressed: preference === 'video', active: runningVideo, busy: checking || switching,
    disabled: false,
    title: preference === 'video' ? 'Prefer music videos' : 'Prefer song versions',
  };
}
