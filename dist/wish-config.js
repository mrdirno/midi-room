// Published client configuration, intentionally public and insert-only by RLS.
// Source: https://github.com/mrdirno/vibe-cards/blob/main/src/site/_wish/config.json
// Changing hosts or rotating the public anon key is a configuration change.
export const WISH_CONFIG = Object.freeze({
  endpoint: 'https://fxjucjvfmklbpapretzr.supabase.co/rest/v1/vibe_card_wishes',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4anVjanZmbWtsYnBhcHJldHpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2OTQwNzUsImV4cCI6MjA4NDI3MDA3NX0.UVQm1A4okSvej0UJLiKetiFuB4H9Prjv4rYcnGYVBYs',
  cardId: 'midi-room-card',
  pageURL: 'https://persona500.com/midi-room/'
});
