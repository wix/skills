// Renders the assembled getFullMenu() tree: menus → sections → item cards, with the empty state.
// This is the menu render surface's body (the Menu page is a thin wrapper). Ordered already by
// the helper (sectionIds / itemIds). Styled with base44 design tokens (shadcn Tailwind classes). Each
// card's onOpen gets the item plus the menuId/sectionId it was shown under — ordering needs both.
import MenuItemCard from "./MenuItemCard";

function imageUrl(img) {
  const url = img?.url;
  return url ? (url.startsWith("//") ? `https:${url}` : url) : null;
}

export default function MenuList({ menus, onOpenItem, empty = "No menu yet — add one from your Wix dashboard." }) {
  if (!menus?.length) {
    return <p className="text-muted-foreground p-4 text-center">{empty}</p>;
  }
  return (
    <div className="flex flex-col gap-8">
      {menus.map((menu) => (
        <section key={menu.id}>
          <h2 className="font-display mb-1">{menu.name}</h2>
          {menu.description && (
            <p className="text-muted-foreground mb-4">{menu.description}</p>
          )}
          {menu.sections.map((section) => (
            <div key={section.id} className="mb-6">
              <h3 className="font-display mb-4">{section.name}</h3>
              {imageUrl(section.image) && (
                <img src={imageUrl(section.image)} alt={section.name} loading="lazy"
                  className="w-full max-h-[220px] object-cover rounded-lg mb-4" />
              )}
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
                {section.items.map((item) => (
                  <MenuItemCard key={item.id} item={item}
                    onOpen={() => onOpenItem?.(item, { menuId: menu.id, sectionId: section.id })} />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
