# Routes

The mockup is a Vite-served single document with query-driven screens.

| URL | Screen | Source |
| --- | --- | --- |
| `/` | title | `design-mockup/index.html` |
| `/?screen=workspace` | operations workspace | `design-mockup/scripts/render.js#renderWorkspace` |
| `/?screen=hacking` | hacking network | `design-mockup/scripts/render.js#renderHacking` |

`design-mockup/scripts/main.js` owns screen switching and click/keyboard behavior.
