/**
 * Публичная поверхность фичи realtime-presence (SLT-37). Внешние слои (app, widgets/canvas)
 * импортируют `@/features/realtime-presence`, а не внутренние файлы — раскладка
 * (lib/model/ui) остаётся деталью реализации.
 */
export type { PresenceUser } from './lib/realtime.contracts';
export type { RemoteCursor } from './model/realtime.store';
export { useRealtimeStore } from './model/realtime.store';
export { useRealtimePresence } from './model/useRealtimePresence';
export { PresenceBar } from './ui/PresenceBar';
