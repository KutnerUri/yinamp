export function createDebouncedSave(save, delay = 250) {
  let timer;
  function flush() {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    save();
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  }
  return { schedule, flush };
}
