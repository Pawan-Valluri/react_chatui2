# APCOT Chat Frontend Client

This is a high-performance, beautiful, and integration-ready React client built using **TypeScript**, **Vite**, `@assistant-ui/react` primitives, and **Pure Vanilla CSS**.

---

## 🎨 Design Philosophy & Intranet Compliance

In strict compliance with **air-gapped enterprise intranet requirements** and the architectural guidelines in **`ui-project-bootstrap-guidelines.md`**:

- **No External Dependencies (Air-Gapped Ready)**: Completely free of Google Fonts, external CDNs, or third-party tracking scripts. All animations, icons, styles, and font-families rely strictly on pre-installed local system stacks.
- **Tailwind-Free / PostCSS-Free**: The entire styling framework is written in pure Vanilla CSS (`frontend/src/app/styles/App.css`), using high-end glassmorphism, responsive grid layouts, custom scrollbars, and fluid ease-out cubic-bezier transition curves for micro-animations.
- **Strict Boundary Encapsulation**: The reusable application layer is separated from development bootstrapper:
  - `src/main.tsx` is used **only** for mounting the client during standalone development.
  - `src/app/` represents the **reusable, fully encapsulated React component tree** that can be compiled and mounted seamlessly into any external host application.

---

## ⚙️ Injectable Configuration (Prop Injection)

Instead of relying on rigid, build-time environment variables (`import.meta.env`), the application accepts an optional config object at its entrypoint component (`App.tsx`). This allows host platforms to inject dynamic routing or credentials on the fly:

```tsx
import { App } from './app/App';

export default function EmbeddedChatWorkspace() {
  return (
    <App config={{
      enableSSO: true,
      ssoLoginUrl: "https://intranet.company.com/sso/login",
      ssoLogoutUrl: "https://intranet.company.com/sso/logout"
    }} />
  );
}
```

### Fallback Resolution Sequence
1. **Config Prop**: Uses values provided explicitly via React props.
2. **Environment Variables**: Falls back to `import.meta.env` if properties are omitted.
3. **Local Dev Defaults**: Cascades gracefully to local simulator defaults.

---

## 🧠 Custom `@assistant-ui/react` Local Runtime

The application integrates with the `@assistant-ui/react` primitives through a highly customized local runtime in `CustomChat.tsx`:

- **Topological Sorting**: Pre-processes conversation histories topologically by checking `parentId` associations to ensure multi-path branching trees reconstruct inside the local store in perfect chronology.
- **Self-Healing Branch Tree**: Gracefully repairs corrupted branch histories by resetting `parentId` pointers to `null` if their target message is absent from database responses, preventing client-side react-error loops.
- **Unified Retractable Steps**: Combines sequential LangGraph thinking blocks and tool call executions into a single, compact `ThreadMessageSteps` visualizer. It displays live progress spinners and step numbers during generation, and auto-retracts into a neat, green-checked summary block upon generation completion.

---

## 🚀 Running Independently

```bash
# Install dependencies
npm install

# Start Vite dev server
npm run dev

# Run TypeScript compilation validation
npx tsc --noEmit
```
