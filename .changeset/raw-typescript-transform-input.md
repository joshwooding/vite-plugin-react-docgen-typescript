---
"@joshwooding/vite-plugin-react-docgen-typescript": patch
---

Run docgen before Vite strips TypeScript syntax so project-service mode receives
the component's imports and prop annotations instead of treating them as `any`.
