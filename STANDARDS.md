# LuTools — Development Standards for New Tools

This document defines the strict architecture, design guidelines, and UX standards for adding any new **tool** to the **LuTools** platform. Any agent working on this repository must read and adhere to these guidelines precisely.

---

## 🚀 General Core Concepts

1. **Terminology:** 
   - We use the word **"tool"** to refer to a single standalone utility page (e.g., `Resizer Image` is a tool).
   - Each **tool** represents a separate, isolated subpage/route and has no operational dependencies on other tools.

2. **Extensibility & Automatic Listing:**
   - Every new **tool** must be defined as a standalone React component inside `src/pages/tools/`.
   - The tool must be registered in [src/toolsRegistry.ts](file:///C:/Users/luank/Videos/ToolLu2/LuTools/src/toolsRegistry.ts).
   - Once registered, a corresponding dashboard card is **automatically** created on the homepage, and the dynamic router **automatically** hooks up the URL path (e.g., `https://lutools.vercel.app/newtool`).

---

## 🎨 Layout & UI/UX Standards

All tools must strictly conform to the **compact, modern, luxurious, simple, and pure white ("trắng tinh khôi")** theme:

### 1. Header Layout (Extremely Compact)
- **Fixed Height:** Height must remain strictly compact (set by `--header-height: 44px` in `index.css`).
- **Logo Behavior:** The logo icon `"Lu"` must remain fixed at the left. Clicking it navigates the user back to the homepage (`/`).
- **Dynamic Header Label:** Inside a specific tool's page, the header label dynamically displays the **name of that tool** (e.g., `"Resizer Image"`), instead of the generic `"LuTools"`. This acts as the primary page title.
- **No Duplicate Headers:** Do **not** render a duplicate large `<h1>` page title inside the main workspace. The dynamic header title is the single source of truth.

### 2. Main Workspace Layout
- **Description:** Render a small, muted subtitle (`<p className="tool-subtitle">`) at the very top of the main container, directly below the compact header, explaining what the tool does.
- **Maximized Workspace:** Keep spacing tight (`.tool-header { margin-bottom: 16px; }`). The rest of the page space must be dedicated entirely to the core tool features, inputs, controls, and output previews.
- **Pure White Theme:** Maintain a pristine minimalist interface using `#ffffff` surfaces, extremely thin borders (`rgba(0,0,0,0.06)`), and elegant ambient shadows (`box-shadow: 0 2px 8px rgba(0,0,0,0.02)`).
- **Premium Actions:** Primary buttons flip beautifully from high-contrast dark to transparent/white outline on hover. Spacings must feel premium and clean.
- **No Footers:** There must be **no** footer section inside the tool views to keep focus entirely on the tool workspace.

### 3. Desktop Clipboard Support (UX Standard)
- Where applicable (especially in file or image input tools), the tool must implement **Ctrl + V** paste listener support so users can instantly load files or data from their operating system clipboard without clicking.
- Include a subtle hint (e.g. `or press Ctrl + V to paste`) in the upload zone.

---

## 📂 Implementation Checklist for Adding a New Tool

1. Create a component file under `src/pages/tools/[ToolName].tsx`.
2. Clean up any unused imports to prevent compiler errors.
3. Register the new tool in `src/toolsRegistry.ts` (import the component, add the configuration entry with a unique `id`, `name`, `path` like `/newtool`, `description`, `category`, and `iconName` matching a Lucide icon).
4. Run `npm run build` to ensure the project compiles with 100% success.
