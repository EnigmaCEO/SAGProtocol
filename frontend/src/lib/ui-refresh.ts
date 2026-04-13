export const UI_REFRESH_EVENT = 'sagitta:refresh';

export function emitUiRefresh(reason?: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(UI_REFRESH_EVENT, {
      detail: {
        reason: reason ?? 'manual',
        at: Date.now(),
      },
    })
  );
}

