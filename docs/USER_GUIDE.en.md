# LuckyNote 0.2 User Guide

[繁體中文使用手冊](USER_GUIDE.zh-TW.md) · [Deployment](DEPLOYMENT.md) · [Android details](ANDROID.md)

This guide describes the features implemented in version 0.2. The default in-app name is **抽獎NOTE**, including when the interface is switched to English. You can customize it in Settings. The app combines rich-text documents, a sketch canvas, note tables and a task board; it does not reproduce every feature of AFFiNE or AppFlowy.

## 1. Know which mode you are using

| Mode | Where data lives | Identity and sharing | Offline behavior |
| --- | --- | --- | --- |
| Self-hosted website / PWA | Your administrator's server database and attachment directory | Server accounts; Google login and group collaboration after configuration | An already open document can retain edits in the current tab and merge after reconnection; there is no persistent offline database in this mode |
| Local website preview | IndexedDB for this website origin and browser profile | An automatic device-only identity; no Google login or remote groups | The page initially needs a connection to load. Data persists in browser storage; this preview does not register an offline service worker |
| Android local APK | The app's own IndexedDB, separate from mobile browser storage | No login and no built-in shared-server connection | The bundled interface opens offline. This is a WebView wrapper, not a native rewrite |

Local mode displays a **Device-only mode** banner. Notes marked **【示範】** in the website preview are editable, removable synthetic examples for travel, shopping and SOPs. They are not other users' data.

Local notes do not automatically move to the website, another device or a self-hosted server. Use compatible JSON export/import when you want to transfer notes. Server privacy is controlled by accounts and workspace permissions; local privacy relies on access to your device and browser. Local mode does not add a separate app password, and the product does not claim end-to-end encryption.

## 2. Start and install

### Self-hosted website / PWA

1. Open the HTTPS address supplied by your administrator. Installing a PWA does not start an unavailable backend.
2. Use a configured sign-in method. An unavailable Google button means the administrator must finish OAuth setup; never paste an API key into the interface.
3. On iPhone, use Safari's Share menu and **Add to Home Screen**. On Android, use a supported browser's **Install app** or **Add to Home screen** option. Availability and wording vary by browser.
4. Before refreshing or updating, wait for **Document synced** and save any changed note properties. Refreshing is not a recovery method for unsynced edits.

The PWA and website use the same interface. Changing the in-app name or icon does not rewrite an installed operating-system icon. Home-screen branding comes from deployed installation assets, and update timing depends on the platform.

### Android APK

If a downloadable APK has been published, get it from this project's [Releases](https://github.com/tonykfr1234/lucky-note/releases) and check that release's SHA-256 and verification reports. Source code or a workflow alone does not prove that an APK was built successfully.

The current package is a **debug-signed development APK** for Android 8.0 or newer, not a production Play Store release. Allow installation only from a release source you trust; do not disable Play Protect. iPhone cannot install an APK—use the website/PWA.

Debug certificates may differ between builds, so in-place upgrades are not guaranteed. If signatures are incompatible, **export your data before considering uninstalling**. Uninstalling deletes the app's local data. A shared HTTPS server opens in the system browser; the APK does not automatically send its local notes there. See [Android details](ANDROID.md).

## 3. Create your first note

1. Choose a workspace. On a phone, open the menu first if the sidebar is hidden.
2. Select **New note**, then choose a blank note or a template. Cancelling the template dialog creates nothing.
3. Enter a title and edit the body in **Document**.
4. Choose a notebook, enter comma-separated tags, and press **Save**.

Content and properties have separate save behavior:

| Data | Server mode | Local mode |
| --- | --- | --- |
| Rich text and sketch data | Automatically synchronize; **Document synced** follows the server acknowledgement | Automatically write to the device database; **Saved on this device** follows a successful commit |
| Title, tags and notebook | Press **Save** | Press **Save** |
| Selected media attachments | Upload and appear after completion | Store on this device and appear after completion |

**Properties saved** does not necessarily mean that the document body has synchronized. Check both indicators.

![Actual document interface in Traditional Chinese](screenshots/desktop-note-zh.png)

Screenshots come from the running app in Chrome using synthetic test data. Mobile-sized screenshots do not prove physical-device installation or camera behavior.

## 4. Rich text, checklists and templates

The toolbar provides paragraphs/headings, bold, italic, strikethrough, inline code, bullet lists, ordered lists, task lists, blockquotes, code blocks, links, undo and redo. Select text before applying a format, or select a format before typing. Task checkboxes are interactive, and the document shows completion progress.

The **Markdown** tab is a **read-only export view** of the current document. Return to **Document** to edit. Link input validates supported URLs; cancelling the link dialog leaves content unchanged.

There are 12 editable templates plus a blank note:

| Template | Intended use |
| --- | --- |
| Travel planner | Destination, daily itinerary, accommodation and transport |
| Packing list | Documents, clothes, essentials and quantities |
| Groceries | Shopper, budget, quantities, currencies and item status |
| Travel shopping | Wishlist, gifts, recipients and shops |
| Task list | Priorities, weekly plans and completion criteria |
| Standard procedure | Version, owner, effective date, steps, acceptance and recovery |
| Meeting notes | Agenda, decisions, actions, owners and due dates |
| Daily journal | Reflections, small wins and tomorrow's plans |
| Learning notes | Sources, concepts, questions and practice |
| Expense record | Receipts, payer, participants and notes |
| Maintenance log | Symptoms, diagnosis, backup, repair and verification |
| Idea collection | Ideas, references, sketches and the next experiment |

Template fields such as SOP version, item quantity, price and status are editable document text. They do not run workflows, provide formal revision management or convert currencies. An expense template does not create a ledger entry automatically; use **Shared ledger** to calculate shares.

## 5. Organize and use the phone layout

- **Workspaces** separate private notes and groups. Search, notebooks and boards operate in the selected workspace.
- **Notebooks** are created from the sidebar and assigned in a note's properties.
- **Tags** use comma-separated values. Save them before using the collection's tag filters.
- **Search** matches note titles, text and tags; it is not photo OCR or video-content search.
- **Card / table views** show the same notes. The table is not a customizable relational database.
- **Task board** groups notes into To do, In progress and Done. Drag a card or use its status menu. Board status uses note tags and is separate from checkboxes inside the document.

Phone/browser Back first closes an open dialog or note. If changes are not saved or synced, cancel the leave confirmation to keep the draft. You can scroll the document while the keyboard is open; content hidden by the keyboard has not necessarily disappeared.

![Mobile shopping document](screenshots/mobile-shopping-zh.png)

[Mobile task board](screenshots/mobile-board-zh.png) · [iPhone-sized layout](screenshots/iphone16-pro-max-portrait.png) · [Galaxy-sized layout](screenshots/galaxy-s26-360-portrait.png)

## 6. Photos, videos, camera and sketches

Use **Upload** in the attachment section to select a file, or **Camera** to open the device's camera/file-selection flow. Cancelling selects nothing. The app does not scan your entire photo library by default.

Each attachment is limited to 20 MB, with type and content checks. Video and audio playback still depend on the browser and device's codecs. Camera permissions and native capture should be checked on your actual phone.

Select **Sketch** to open the canvas. It supports pen color and width, an eraser, undo/redo and clearing. Saving retains editable strokes and adds a PNG attachment. Use **Edit sketch** to continue later.

**A canvas is saved as one whole value, not merged stroke by stroke.** Concurrent saves can replace another person's canvas; separate notes are recommended for separate drawings. If another update arrives while your canvas is open, local unsaved strokes are preserved and replacement requires confirmation. If strokes save but the PNG fails, the canvas remains available to retry.

The current APK's native export supports JSON, Markdown and plain text, not exporting photos, videos or other binary attachments to an external destination. Attachments can still be previewed in the app. Keep independent copies of important original media.

## 7. Groups and collaboration

This section applies to server mode. Local preview and the APK do not create remote groups.

1. An administrator deploys an HTTPS server and configures sign-in.
2. Create a shared workspace. In **Members & access**, add an account already registered on the same server.
3. Choose editor or viewer access. Owners manage membership, editors modify content, and viewers read.
4. Members opening the same document can edit together. Document text uses CRDT merging; the app does not display unimplemented presence indicators or collaborator cursors.

Production sharing requires both the owner and the added member to use verified Google identities. Development password accounts are test identities: typing an email address does not prove ownership of that mailbox. Adding a member sends no invitation email. Google sign-in does not grant Drive, Gmail or Calendar access.

When disconnected, an already loaded document can keep edits in **the current tab's memory** and merge after reconnection. Closing the tab, switching notes, reloading or an operating-system browser shutdown can lose unsynced changes. Keep the tab open and export a draft when necessary. A rejected update, expired session or revoked permission stops editing and must not be treated as a normal network outage.

Title, tags and notebook assignment have separate version checks. A newer remote version does not silently replace your property draft. Use **Download my draft**, then **Load remote properties** to compare. Document collaboration is handled separately from this property conflict.

## 8. Shared expenses

1. Open **Shared ledger** and choose **Add expense**.
2. Enter the description, amount in TWD, actual payer and equal-share participants.
3. Save, then inspect each member's balance and settlement suggestions.

The ledger currently supports **TWD with up to two decimal places**, calculated in integer minor units. Remainders use a deterministic rule so shares preserve the total. This is not a multi-currency ledger: entering JPY in a shopping template does not convert currencies.

Make any real payment outside the app first. Record it as paid, then the recipient must confirm actual receipt before the settlement changes ledger balances. No button transfers money through LINE Pay, a bank or another payment service, and the app does not hold funds.

Local mode has only one device identity. You can record personal expenses, but it does not simulate real multi-user settlement.

![Actual shared ledger](screenshots/desktop-ledger-zh.png)

## 9. Appearance and external tools

In **Settings & profile**, change interface language, light/dark mode, display name, avatar, and the in-app brand name/icon. Appearance preferences are stored per device.

The collection includes 10 AI-generated images and 10 procedural backgrounds, plus your own image. Thumbnails load first; only the selected full background loads. Avatar, icon and custom-background images must be PNG, JPEG or WebP under 512 KB.

![Background selector](screenshots/background-gallery-zh.png)

**Tools & integrations** reports real configuration status:

| Tool | Current scope |
| --- | --- |
| Google sign-in | Available after administrator OAuth setup; does not automatically authorize other Google services |
| Drive, Calendar, Gmail, LINE | Backend interfaces and preview/confirmation designs exist; credentials, destinations and permissions still need configuration. Full end-user operation UI is limited, and a status card is not proof of delivery |
| AI classification | With a server OpenAI key, select source notes, starting date, timezone and token budget; preview selected metadata, confirm sending, then manually confirm filing decisions |
| Translation | Explicitly enter text, choose a target language and confirm sending; review and copy the result yourself |
| Speech to text | A backend adapter exists; the full user upload/budget/confirmation workflow is not enabled |
| Google Photos / photo scanning | A Picker UI is not implemented, and the app does not scan all photos or videos in the background |

Local mode does not connect to these external services. A ChatGPT subscription does not include OpenAI API credit. AI requests have request and daily budget limits. Never place API keys in notes, frontend settings or a public repository. Core notes remain usable when external tools are unconfigured. See [integration details](INTEGRATIONS.md).

## 10. Export, restore and protect data

### Transfer notes

- **Export Markdown** at the bottom of a note exports current document text, useful for reading or preserving a text draft. It is not a complete sketch or attachment backup.
- Use the collection's **More actions → Export notes as JSON** for the current workspace's notes and notebooks.
- In a destination workspace, choose **Import notes JSON**. Use this app's compatible archive format and test in an empty workspace first; this is not a general Evernote/Notion importer.
- Import creates notes rather than acting as overwrite synchronization. Retries of the same operation are deduplicated; starting a new import can create new copies.

JSON **does not include attachment binaries, ledger entries, accounts, memberships/permissions, external-service configuration, appearance preferences or complete collaboration history**. Sketch data embedded in compatible note content can be retained, but the PNG attachment is not included; inspect restored drawings. Cross-mode imports rebuild documents. Local imports retain some unsupported inline Markdown as literal text and do not guarantee identical formatting.

Browsers only report that a download was requested: check your Downloads folder. The APK uses the system save picker and reports success only after a successful save result. Cancelling is not success. A native APK export is limited to 10 MiB per operation.

### Avoid losing local data

Local notes belong to a website origin, browser profile or APK. Private browsing, clearing site data, resetting a browser, uninstalling the APK, device failure or storage eviction can remove them. Browser and APK storage are separate. **Saved** does not mean a separate backup exists.

A full server backup is an administrator task covering the database, attachments and necessary configuration. Follow [deployment and backup instructions](DEPLOYMENT.md). UI JSON export is not a replacement for a full backup.

## 11. Common situations

| Situation | What to do |
| --- | --- |
| Save is disabled after editing the body | The body saves automatically; Save handles title, tags and notebook. Check the document indicator |
| Offline or still syncing | Keep the current tab open; check network/server availability and export a draft if needed |
| Access changed or an update was rejected | Export any available draft, then verify your account and access; do not repeatedly resubmit |
| Device storage is full or saving failed | Keep the page, export first, then check space and storage permissions. Do not immediately clear site data |
| Notes are missing on another device | Check the mode, URL, account and workspace. Local mode has no cross-device sync |
| Camera or video does not work | Check permissions, file format and device support; use file selection where possible |
| Google or AI is unavailable | Check configuration status and ask the administrator. Local mode intentionally has no external connection |
| Unsure whether a new APK can replace the old one | Back up first and check signing/release notes. Do not uninstall the only copy of your data |

[Feature acceptance](ACCEPTANCE.md) · [Mobile validation scope](MOBILE-VALIDATION.md) · [Security policy](../SECURITY.md)

