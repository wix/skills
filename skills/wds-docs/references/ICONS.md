# WDS Common Icons

Import: `import { IconName } from '@wix/wix-ui-icons-common';`

Props: `size?: string | number` + all SVG attributes.

## Naming Convention

- **Resizable icons** have two variants: `IconName` (24px default) and `IconNameSmall` (18px)
- **Filled variants:** `IconNameFilled` / `IconNameFilledSmall`
- Use **Small** variants inside `TableActionCell` secondary actions and compact UI
- Use standard (non-Small) variants for buttons, page headers, and general UI

---

## Most-Used Icons by Category

### CRUD Actions
| Icon | Usage |
|------|-------|
| `Add` / `AddSmall` | Create/add new item |
| `Edit` / `EditSmall` | Edit item |
| `Delete` / `DeleteSmall` | Delete/remove item |
| `Duplicate` / `DuplicateSmall` | Duplicate/copy item |
| `Confirm` / `ConfirmSmall` | Confirm/approve action |
| `Dismiss` / `DismissSmall` | Cancel/dismiss |

### Navigation & Views
| Icon | Usage |
|------|-------|
| `ChevronDown` / `ChevronDownSmall` | Expand, dropdown |
| `ChevronRight` / `ChevronRightSmall` | Navigate forward, drill-in |
| `ChevronLeft` / `ChevronLeftSmall` | Navigate back |
| `ChevronUp` / `ChevronUpSmall` | Collapse |
| `ArrowRight` / `ArrowRightSmall` | Direction |
| `ExternalLink` / `ExternalLinkSmall` | Open in new tab |
| `More` / `MoreSmall` | More options (horizontal dots) |
| `VerticalMenu` / `VerticalMenuSmall` | More options (vertical dots) |

### Content & Data
| Icon | Usage |
|------|-------|
| `Search` / `SearchSmall` | Search |
| `Filters` / `FiltersSmall` | Filter content |
| `SortAscending` / `SortAscendingSmall` | Sort ascending |
| `SortDescending` / `SortDescendingSmall` | Sort descending |
| `DownloadImport` / `DownloadImportSmall` | Download/import |
| `UploadExport` / `UploadExportSmall` | Upload/export |
| `Print` / `PrintSmall` | Print |
| `Refresh` / `RefreshSmall` | Refresh/reload |

### Status & Feedback
| Icon | Usage |
|------|-------|
| `StatusComplete` / `StatusCompleteSmall` | Success/done |
| `StatusAlert` / `StatusAlertSmall` | Error/alert |
| `StatusWarning` / `StatusWarningSmall` | Warning |
| `Info` / `InfoSmall` | Information |
| `Help` / `HelpSmall` | Help |
| `Visible` / `VisibleSmall` | Show/visible |
| `Hidden` / `HiddenSmall` | Hide/hidden |

### Communication
| Icon | Usage |
|------|-------|
| `Email` / `EmailSmall` | Email |
| `EmailSend` / `EmailSendSmall` | Send email |
| `Chat` / `ChatSmall` | Chat/message |
| `Phone` / `PhoneSmall` | Phone |
| `Send` / `SendSmall` | Send |

### Users & People
| Icon | Usage |
|------|-------|
| `User` / `UserSmall` | Single user |
| `Users` / `UsersSmall` | Multiple users |
| `UserAdd` / `UserAddSmall` | Add user |
| `UserRemove` / `UserRemoveSmall` | Remove user |

### Commerce
| Icon | Usage |
|------|-------|
| `Cart` / `CartSmall` | Shopping cart |
| `CreditCard` / `CreditCardSmall` | Payment |
| `Shipping` / `ShippingSmall` | Shipping/delivery |
| `Tag` / `TagSmall` | Tag/label |
| `Discount` / `DiscountSmall` | Discount/coupon |
| `Receipt` / `ReceiptSmall` | Receipt/invoice |
| `Package` / `PackageSmall` | Package |

### Settings & Config
| Icon | Usage |
|------|-------|
| `Settings` / `SettingsSmall` | Settings |
| `LockLocked` / `LockLockedSmall` | Locked/secure |
| `LockUnlocked` / `LockUnlockedSmall` | Unlocked |
| `Globe` / `GlobeSmall` | Global/international |
| `Languages` / `LanguagesSmall` | Multi-language |

### Media
| Icon | Usage |
|------|-------|
| `Image` / `ImageSmall` | Image |
| `PhotoCamera` / `PhotoCameraSmall` | Camera/photo |
| `VideoCamera` / `VideoCameraSmall` | Video |
| `Document` / `DocumentSmall` | Document/file |
| `Attachment` / `AttachmentSmall` | Attach file |

### Misc
| Icon | Usage |
|------|-------|
| `Star` / `StarFilled` | Rating/favorite |
| `Favorite` / `FavoriteFilled` | Heart/like |
| `FavoriteSmall` / `FavoriteFilledSmall` | Heart small |
| `Pin` / `PinSmall` | Pin/location |
| `Location` / `LocationSmall` | Location |
| `Date` / `DateSmall` | Calendar/date |
| `Time` / `TimeSmall` | Clock/time |
| `Link` / `LinkSmall` | Link |
| `Unlink` / `UnlinkSmall` | Remove link |
| `Copy` | Copy to clipboard |
| `Share` / `ShareSmall` | Share |
| `Flag` / `FlagSmall` | Flag/report |
| `Bookmark` / `BookmarkSmall` | Bookmark/save |

---

## Usage Examples

```tsx
import { Add, Delete, Edit, Search } from '@wix/wix-ui-icons-common';

<Button prefixIcon={<Add />}>Add Item</Button>
<IconButton><Delete /></IconButton>
<TableActionCell secondaryActions={[
  { text: 'Edit', icon: <EditSmall />, onClick: handleEdit },
  { text: 'Delete', icon: <DeleteSmall />, onClick: handleDelete },
]} />
```

## Icon Size Override

```tsx
<Add size={20} />
<DeleteSmall size={16} />
```
