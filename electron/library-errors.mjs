export const LIBRARY_CANCELLED = 'LIBRARY_CANCELLED';

export function libraryCancelled() {
  return Object.assign(new Error('The account changed. Refresh the library.'), { code: LIBRARY_CANCELLED });
}

// Resolve expected cancellations across IPC so Electron does not log them as
// handler failures. Unexpected errors still reject with their original details.
export async function settleLibraryRequest(work) {
  try { return await work(); }
  catch (error) {
    if (error?.code === LIBRARY_CANCELLED) return { cancelled: true };
    throw error;
  }
}
