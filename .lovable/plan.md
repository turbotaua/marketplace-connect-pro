

## Problem

The sidebar `<aside>` has no fixed height constraint. It uses `min-h-screen` on the parent but the aside itself grows with content. The `ScrollArea` with `flex-1` only works if the parent has a bounded height.

## Fix

One line change in `AdminLayout.tsx` line 87: add `h-screen` and `overflow-hidden` to the aside so the flex column is bounded and `ScrollArea` scrolls internally instead of expanding the sidebar.

```
// Line 87, change:
"flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 ease-in-out"
// to:
"flex flex-col h-screen sticky top-0 border-r border-sidebar-border bg-sidebar transition-all duration-300 ease-in-out"
```

This makes the sidebar exactly viewport height and sticky, so the chat list scrolls inside `ScrollArea` while brand, tools, and user footer stay pinned.

