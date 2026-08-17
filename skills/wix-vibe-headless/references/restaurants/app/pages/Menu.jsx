// Menu page — the restaurant's main render surface. Loads the assembled getFullMenu() tree once,
// renders it via MenuList, and opens ItemDialog for a tapped dish (add-to-order lives there).
// Empty state when there are no menus. Styled with base44 design tokens (shadcn Tailwind classes).
import { useEffect, useState } from "react";
import { getFullMenu } from "@/rest/wix-restaurants-menu";
import MenuList from "@/components/MenuList";
import ItemDialog from "@/components/ItemDialog";

export default function Menu() {
  const [menus, setMenus] = useState(null);
  const [active, setActive] = useState(null);   // { item, menuId, sectionId }

  useEffect(() => { getFullMenu().then(({ menus }) => setMenus(menus)); }, []);

  return (
    <main className="max-w-[1040px] mx-auto p-4">
      <h1 className="font-display mb-4">Menu</h1>
      {menus === null
        ? <p className="text-muted-foreground">Loading…</p>
        : <MenuList menus={menus} onOpenItem={(item, ctx) => setActive({ item, ...ctx })}
            empty="No menu yet — add one from your Wix dashboard." />}
      {active && (
        <ItemDialog item={active.item} menuId={active.menuId} sectionId={active.sectionId}
          onClose={() => setActive(null)} />
      )}
    </main>
  );
}
