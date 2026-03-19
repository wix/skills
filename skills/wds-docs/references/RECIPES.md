# WDS Dashboard Recipes

Copy-and-adapt patterns for common dashboard layouts. All imports from `@wix/design-system`.

---

## 1. CRUD Table Page

Full dashboard page with toolbar, search, table with actions, and empty state.

```tsx
import {
  Page, Table, TableToolbar, TableActionCell,
  Card, Search, Button, Box, Text, Badge, EmptyState, TextButton, Loader,
} from '@wix/design-system';
import { Add, DeleteSmall, EditSmall, DuplicateSmall } from '@wix/wix-ui-icons-common';

function ProductsPage() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const columns = [
    { title: 'Name', render: (row) => <Text weight="bold">{row.name}</Text>, width: '40%' },
    { title: 'Status', render: (row) => (
      <Badge skin={row.active ? 'success' : 'neutral'} size="small">
        {row.active ? 'Active' : 'Inactive'}
      </Badge>
    )},
    { title: 'Price', render: (row) => `$${row.price.toFixed(2)}`, align: 'right' },
    {
      title: '',
      render: (row) => (
        <TableActionCell
          primaryAction={{ text: 'Edit', onClick: () => handleEdit(row) }}
          secondaryActions={[
            { text: 'Duplicate', icon: <DuplicateSmall />, onClick: () => handleDuplicate(row) },
            { text: 'Delete', icon: <DeleteSmall />, onClick: () => handleDelete(row), skin: 'destructive' },
          ]}
          numOfVisibleSecondaryActions={0}
          moreActionsTooltipText="More actions"
        />
      ),
      stickyActionCell: true,
      width: '72px',
    },
  ];

  const filtered = items.filter(item =>
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <Page height="calc(100vh - 48px)">
        <Page.Header title="Products" />
        <Page.Content>
          <Box align="center" verticalAlign="middle" height="300px">
            <Loader size="medium" />
          </Box>
        </Page.Content>
      </Page>
    );
  }

  return (
    <Page height="calc(100vh - 48px)">
      <Page.Header
        title="Products"
        actionsBar={<Button prefixIcon={<Add />}>Add Product</Button>}
      />
      <Page.Content>
        <Card hideOverflow>
          <Table data={filtered} columns={columns}>
            <TableToolbar>
              <TableToolbar.ItemGroup position="start">
                <TableToolbar.Item>
                  <TableToolbar.Title>All Products</TableToolbar.Title>
                </TableToolbar.Item>
              </TableToolbar.ItemGroup>
              <TableToolbar.ItemGroup position="end">
                <TableToolbar.Item>
                  <Search
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onClear={() => setSearch('')}
                    placeholder="Search products..."
                  />
                </TableToolbar.Item>
              </TableToolbar.ItemGroup>
            </TableToolbar>
            {filtered.length === 0 ? (
              <Table.EmptyState>
                <EmptyState
                  title="No products found"
                  subtitle="Try a different search or add a new product."
                >
                  <TextButton prefixIcon={<Add />}>Add Product</TextButton>
                </EmptyState>
              </Table.EmptyState>
            ) : (
              <Table.Content />
            )}
          </Table>
        </Card>
      </Page.Content>
    </Page>
  );
}
```

---

## 2. Form Modal (Add/Edit)

Modal with form fields, validation, and save/cancel.

```tsx
import {
  Modal, CustomModalLayout, Box, FormField, Input, NumberInput,
  InputArea, Dropdown, ToggleSwitch, Text, Layout, Cell,
} from '@wix/design-system';

function ItemFormModal({ isOpen, onClose, onSave, item }) {
  const [name, setName] = useState(item?.name ?? '');
  const [price, setPrice] = useState(item?.price ?? 0);
  const [description, setDescription] = useState(item?.description ?? '');
  const [category, setCategory] = useState(item?.categoryId ?? '');
  const [active, setActive] = useState(item?.active ?? true);
  const [errors, setErrors] = useState({});

  const validate = () => {
    const newErrors = {};
    if (!name.trim()) newErrors.name = 'Name is required';
    if (price < 0) newErrors.price = 'Price must be positive';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    onSave({ name, price, description, categoryId: category, active });
  };

  return (
    <Modal isOpen={isOpen} onRequestClose={onClose} shouldCloseOnOverlayClick>
      <CustomModalLayout
        title={item ? 'Edit Item' : 'Add Item'}
        primaryButtonText="Save"
        primaryButtonOnClick={handleSave}
        secondaryButtonText="Cancel"
        secondaryButtonOnClick={onClose}
        closeButtonProps={{ onClick: onClose }}
        content={
          <Box direction="vertical" gap="SP4">
            <Layout cols={12} gap="24px">
              <Cell span={8}>
                <FormField label="Name" required status={errors.name ? 'error' : undefined} statusMessage={errors.name}>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" />
                </FormField>
              </Cell>
              <Cell span={4}>
                <FormField label="Price" required status={errors.price ? 'error' : undefined} statusMessage={errors.price}>
                  <NumberInput
                    value={price}
                    onChange={(val) => setPrice(val)}
                    min={0}
                    step={0.01}
                    prefix={<Input.Affix>$</Input.Affix>}
                  />
                </FormField>
              </Cell>
            </Layout>
            <FormField label="Category">
              <Dropdown
                options={[
                  { id: 'electronics', value: 'Electronics' },
                  { id: 'clothing', value: 'Clothing' },
                  { id: 'food', value: 'Food' },
                ]}
                selectedId={category}
                onSelect={(opt) => setCategory(opt.id)}
                placeholder="Select category"
              />
            </FormField>
            <FormField label="Description">
              <InputArea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter description"
                rows={3}
                maxLength={500}
                hasCounter
              />
            </FormField>
            <Box verticalAlign="middle" gap="SP2">
              <ToggleSwitch checked={active} onChange={() => setActive(!active)} size="small" />
              <Text size="small">{active ? 'Active' : 'Inactive'}</Text>
            </Box>
          </Box>
        }
      />
    </Modal>
  );
}
```

---

## 3. Delete Confirmation Modal

```tsx
import { Modal, MessageModalLayout } from '@wix/design-system';

function DeleteConfirmModal({ isOpen, onClose, onConfirm, itemName }) {
  return (
    <Modal isOpen={isOpen} onRequestClose={onClose} shouldCloseOnOverlayClick>
      <MessageModalLayout
        title={`Delete ${itemName}?`}
        content="This action cannot be undone. The item and all its data will be permanently removed."
        primaryButtonText="Delete"
        primaryButtonOnClick={onConfirm}
        secondaryButtonText="Cancel"
        secondaryButtonOnClick={onClose}
        closeButtonProps={{ onClick: onClose }}
        skin="destructive"
      />
    </Modal>
  );
}
```

---

## 4. Settings Card with Form

```tsx
import { Card, Box, FormField, Input, ToggleSwitch, Text, Button } from '@wix/design-system';

function SettingsCard() {
  return (
    <Card>
      <Card.Header title="Notification Settings" subtitle="Configure how you receive alerts" />
      <Card.Divider />
      <Card.Content>
        <Box direction="vertical" gap="SP4">
          <FormField label="Email Address" required>
            <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
          </FormField>
          <Box align="space-between" verticalAlign="middle">
            <Box direction="vertical">
              <Text weight="bold">Email Notifications</Text>
              <Text size="small" secondary>Receive alerts via email</Text>
            </Box>
            <ToggleSwitch checked={emailEnabled} onChange={() => setEmailEnabled(!emailEnabled)} />
          </Box>
          <Box align="space-between" verticalAlign="middle">
            <Box direction="vertical">
              <Text weight="bold">SMS Notifications</Text>
              <Text size="small" secondary>Receive alerts via text message</Text>
            </Box>
            <ToggleSwitch checked={smsEnabled} onChange={() => setSmsEnabled(!smsEnabled)} />
          </Box>
          <Box align="right">
            <Button>Save Changes</Button>
          </Box>
        </Box>
      </Card.Content>
    </Card>
  );
}
```

---

## 5. Table with Selection and Bulk Actions

```tsx
import {
  Table, TableToolbar, Card, Button, Box, Text,
} from '@wix/design-system';
import { Delete } from '@wix/wix-ui-icons-common';

function SelectableTable({ items }) {
  const [selectedIds, setSelectedIds] = useState([]);

  const mainToolbar = () => (
    <TableToolbar>
      <TableToolbar.ItemGroup position="start">
        <TableToolbar.Item>
          <TableToolbar.Title>Items ({items.length})</TableToolbar.Title>
        </TableToolbar.Item>
      </TableToolbar.ItemGroup>
    </TableToolbar>
  );

  const selectionToolbar = () => (
    <TableToolbar>
      <TableToolbar.ItemGroup position="start">
        <TableToolbar.Item>
          <TableToolbar.SelectedCount>{`${selectedIds.length} selected`}</TableToolbar.SelectedCount>
        </TableToolbar.Item>
      </TableToolbar.ItemGroup>
      <TableToolbar.ItemGroup position="end">
        <TableToolbar.Item layout="button">
          <Button skin="destructive" priority="secondary" prefixIcon={<Delete />}>
            Delete Selected
          </Button>
        </TableToolbar.Item>
      </TableToolbar.ItemGroup>
    </TableToolbar>
  );

  return (
    <Card hideOverflow>
      <Table
        data={items}
        columns={columns}
        showSelection
        selectedIds={selectedIds}
        onSelectionChanged={(type, change) => {
          if (type === 'ALL') setSelectedIds(items.map(i => i.id));
          else if (type === 'NONE') setSelectedIds([]);
          else if (type === 'SINGLE_TOGGLE') {
            setSelectedIds(prev =>
              change.value ? [...prev, change.id] : prev.filter(id => id !== change.id)
            );
          }
        }}
      >
        {selectedIds.length > 0 ? selectionToolbar() : mainToolbar()}
        <Table.Content />
      </Table>
    </Card>
  );
}
```

---

## 6. Empty Page State

```tsx
import { Page, EmptyState, Button } from '@wix/design-system';
import { Add } from '@wix/wix-ui-icons-common';

function EmptyPage() {
  return (
    <Page height="calc(100vh - 48px)">
      <Page.Header title="Orders" />
      <Page.Content>
        <EmptyState
          title="No orders yet"
          subtitle="Once customers place orders, they'll appear here."
        >
          <Button prefixIcon={<Add />}>Create Order</Button>
        </EmptyState>
      </Page.Content>
    </Page>
  );
}
```
