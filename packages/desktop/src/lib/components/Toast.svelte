<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";

  export type ToastType = "success" | "error" | "warning" | "info";

  interface ToastItem {
    id: number;
    message: string;
    type: ToastType;
    action?: {
      label: string;
      onClick: () => void;
      dismissOnClick?: boolean;
    };
    removing?: boolean;
  }

  // Svelte 5: expose methods to parent via a bindable `api` prop
  // Parent does: let toast = $state<ReturnType<typeof makeToastAPI> | null>(null);
  //              <Toast bind:api={toast} />
  //              toast?.success("Done");
  interface Props {
    api?: ToastController | null;
  }

  export interface ToastController {
    show(message: string, type?: ToastType, duration?: number, action?: ToastItem["action"]): void;
    success(message: string, duration?: number, action?: ToastItem["action"]): void;
    error(message: string, duration?: number): void;
    warning(message: string, duration?: number): void;
    info(message: string, duration?: number): void;
  }

  let { api = $bindable(null) }: Props = $props();

  let toasts = $state<ToastItem[]>([]);
  let nextId = 1;

  const ICONS: Record<ToastType, string> = {
    success: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"/></svg>`,
    error: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"/></svg>`,
    warning: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"/></svg>`,
    info: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"/></svg>`,
  };

  const DURATIONS: Record<ToastType, number> = {
    success: 3000,
    error: 5000,
    warning: 4000,
    info: 3000,
  };

  function dismiss(id: number) {
    toasts = toasts.map(t => t.id === id ? { ...t, removing: true } : t);
    setTimeout(() => {
      toasts = toasts.filter(t => t.id !== id);
    }, 300);
  }

  function show(message: string, type: ToastType = "info", duration?: number, action?: ToastItem["action"]): void {
    const id = nextId++;
    toasts = [...toasts, { id, message, type, action }];
    const ms = duration ?? DURATIONS[type];
    if (ms > 0) setTimeout(() => dismiss(id), ms);
  }

  // Publish the API object through the bindable prop so the parent can call it
  onMount(() => {
    api = {
      show,
      success: (m, d, a) => show(m, "success", d, a),
      error:   (m, d) => show(m, "error", d),
      warning: (m, d) => show(m, "warning", d),
      info:    (m, d) => show(m, "info", d),
    };
    return () => { api = null; };
  });
</script>

<div class="toast-container" role="region" aria-label="Notifications" aria-live="polite">
  {#each toasts as toast (toast.id)}
    <div
      class="toast toast-{toast.type}"
      class:toast-removing={toast.removing}
      role="status"
      aria-atomic="true"
    >
        <span class="toast-icon">{@html ICONS[toast.type]}</span>
        <span class="toast-message">{toast.message}</span>
        {#if toast.action}
          <button
            class="toast-action"
            onclick={() => {
              toast.action?.onClick();
              if (toast.action?.dismissOnClick !== false) dismiss(toast.id);
            }}
          >
            {toast.action.label}
          </button>
        {/if}
        <button class="toast-close" aria-label="Dismiss" onclick={() => dismiss(toast.id)}><Icon name="x" size={14} /></button>
      </div>
  {/each}
</div>

<style>
  .toast-container {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: var(--app-z-toast);
    display: flex;
    flex-direction: column;
    gap: 10px;
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-radius: 8px;
    border: 1px solid transparent;
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    min-width: 240px;
    max-width: 380px;
    box-shadow: 0 4px 16px var(--app-shadow-md);
    pointer-events: all;
    animation: toast-in 0.25s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  }

  .toast-removing {
    animation: toast-out 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  }

  @keyframes toast-in {
    from { opacity: 0; transform: translateX(24px); }
    to   { opacity: 1; transform: translateX(0); }
  }

  @keyframes toast-out {
    from { opacity: 1; transform: translateX(0); }
    to   { opacity: 0; transform: translateX(24px); }
  }

  .toast-success { background: var(--app-success-bg); border-color: var(--app-success-border); color: var(--app-success-text); }
  .toast-error   { background: var(--app-error-bg); border-color: var(--app-error-border); color: var(--app-error-text); }
  .toast-warning { background: var(--app-warning-bg); border-color: var(--app-warning-border); color: var(--app-warning-text); }
  .toast-info    { background: var(--app-info-bg); border-color: var(--app-info-border); color: var(--app-info-text); }

  .toast-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  .toast-message {
    flex: 1;
    line-height: 1.4;
  }

  .toast-action {
    background: transparent;
    border: 1px solid currentColor;
    color: inherit;
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }

  .toast-action:hover {
    background: var(--app-scrim-strong);
  }

  .toast-close {
    flex-shrink: 0;
    background: transparent;
    border: none;
    border-radius: 5px;
    color: inherit;
    cursor: pointer;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* WCAG 2.5.8: minimum target size 24x24px */
    min-width: 24px;
    min-height: 24px;
    padding: 0;
    opacity: 0.7;
    margin-left: 4px;
  }
  .toast-close:hover { opacity: 1; }
  .toast-close:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; opacity: 1; }
</style>
