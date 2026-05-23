# Offline-First Plan

## Can this app work without internet?

Yes.

For this project, the right approach is not to build a separate database first.
The better base is:

1. Bundle the app locally inside the Capacitor build.
2. Enable persistent Firestore cache for app data.
3. Make all core writes optimistic and queue-friendly.
4. Add a separate local outbox only for things Firestore cannot sync by itself well:
   media uploads, external APIs, and special multi-step actions.

This will let the app:

- open without internet;
- show the last known data immediately;
- save text and numeric changes instantly;
- sync them to Firestore automatically when the connection returns.

## What is already in the project

### Good foundation

- Main business data is already stored in Firestore.
- Many key sections already use `onSnapshot(...)`:
  cycles, programs, journal, supplements, reports.
- Meals already have a partial cache-first step with `getDocFromCache(...)`.
- Auth persistence is already configured with IndexedDB/local/session persistence.
- The web version already has a service worker for static files.

### Current blockers for real offline mode

1. The app code is not fully local in native build.
   `index.html` loads CDN scripts (`axios`, `lottie-web`), and `script.js`/`pages/meal.js`
   import Firebase from `https://www.gstatic.com/...`.

2. In Capacitor native mode the service worker is skipped.
   So the native app cannot rely on SW caching to boot offline.

3. Firestore is created via `getFirestore(app)`, but persistent offline cache for Firestore
   data is not explicitly configured.

4. Several features call network-only endpoints:
   - FatSecret search/details
   - Apple Health import endpoint
   - Firebase Storage uploads
   - invite/profile lookup flows that depend on server state

5. A lot of writes replace whole arrays/objects inside documents.
   This is the biggest conflict risk for offline + multi-device editing.

## Recommended architecture

### 1. App shell must be 100% local

Move external runtime dependencies into the build:

- Firebase SDK from npm instead of `gstatic` imports
- `axios` from npm or remove it
- `lottie-web` from npm

Best path: move the app to a small bundler setup such as Vite.

Goal:

- Capacitor `www/` contains everything needed to start the app offline.
- Native startup does not depend on CDN availability.

### 2. Firestore should become the default offline cache for core data

For core entities, use Firestore persistence instead of inventing a full custom sync engine:

- cycles
- programs
- journal
- reports metadata
- supplements plan
- meal goals
- meals data
- food/recipe personal libraries

Desired runtime behavior:

1. App starts.
2. Firestore opens persistent local cache.
3. UI renders cached data immediately.
4. `onSnapshot` refreshes from server when internet is available.
5. Writes are applied locally at once and synced later.

### 3. Add one sync layer instead of writing directly everywhere

Right now many screens call `addDoc`, `setDoc`, `updateDoc`, `deleteDoc` directly.

That works, but for reliable offline mode it is better to route writes through one layer:

- `saveCycle(...)`
- `saveProgram(...)`
- `saveJournalEntry(...)`
- `saveMealDoc(...)`
- `saveSupplementPlan(...)`
- `saveReport(...)`

That layer should:

- write to Firestore immediately;
- attach local metadata;
- normalize timestamps;
- report pending/error/synced state to UI;
- later support retries or special handling without rewriting every screen.

## Sync algorithm

### Core Firestore documents

For normal text/numeric data:

1. User changes something.
2. App calls repository method.
3. Repository writes to Firestore immediately.
4. Firestore stores the mutation locally.
5. UI updates at once from local state/snapshot.
6. When internet returns, Firestore syncs the mutation.
7. Snapshot metadata clears the pending state.

### Metadata to store on important writes

For documents that users edit often, add fields like:

- `updatedAtClient: Date.now()`
- `updatedAtServer: serverTimestamp()`
- `lastMutationId`
- `lastDeviceId`

Why:

- `serverTimestamp()` may be unresolved while offline;
- local sorting should not depend only on server timestamps;
- conflict debugging becomes much easier.

### UI sync states

Add a small sync status model:

- `offline`
- `syncing`
- `synced`
- `error`

Useful places:

- top bar or subtle global badge
- pending badge on edited records
- optional "X changes waiting for sync"

## What Firestore can handle well

- create/edit/delete of cycles
- create/edit/delete of programs
- journal entries
- supplement plan updates
- reports without media
- meal goals
- meals when editing only from one device at a time

## What needs special handling

### 1. Media uploads

Current flow uploads files directly to Firebase Storage and then stores the remote URL.
This will not work offline.

For offline media:

1. Save the selected file locally on device via Capacitor Filesystem.
2. Create a local placeholder record in Firestore-friendly data:
   `uploadState: "pending"`, `localFileUri`, `localPreviewUrl`.
3. When connection returns, upload the file.
4. Replace local placeholder with real `photoUrl` / `videoUrl`.
5. If upload fails, keep retry state.

Important:

- text data can queue automatically;
- raw files need their own durable local queue.

### 2. FatSecret

FatSecret search/details are online-only.

Best behavior:

- if offline, disable that tab cleanly;
- keep user local food library fully available offline;
- optionally cache recent FatSecret results locally for read-only reuse.

### 3. Apple Health import

The import endpoint is also online-only.

Best behavior:

- show it as unavailable offline;
- do not let it block app startup or core meal flows.

### 4. Invite / trainer linking flows

User lookup, invite acceptance, and some profile operations depend on live server state.
These can remain online-required in the first iteration.

That is normal.

## Biggest data-model risk in the current project

Several parts of the app update large nested structures in one write:

- program document with whole `exercises` array
- meal day document with meal arrays inside one day doc
- supplement plan stored as one nested object inside cycle doc

This is acceptable for:

- one user;
- usually one active device;
- fast rollout of offline mode.

But it is risky for:

- trainer + client editing the same data;
- one account on multiple devices;
- long offline periods with concurrent edits.

### Practical rule

If you want offline mode first and fast:

- keep the current model;
- accept "last write wins" for conflicts.

If you want strong multi-device collaboration:

- later split large arrays into smaller documents;
- or introduce operation-based sync for the most conflict-prone parts.

## Rollout plan

### Phase 1. Foundation

- Bundle Firebase/axios/lottie locally.
- Add proper build step.
- Enable persistent Firestore cache.
- Add network status service.
- Add global sync status UI.

### Phase 2. Core offline data

- Move direct writes behind repository helpers.
- Add client/server timestamp fields.
- Make cycles/programs/journal/reports/supplements/meals save instantly offline.
- Replace "network error" messaging with pending/sync messaging where appropriate.

### Phase 3. Online-only feature isolation

- Mark FatSecret as online-only with graceful offline UI.
- Mark Apple Health import as online-only.
- Keep profile/invite flows online-required for now.

### Phase 4. Media outbox

- Add Capacitor Filesystem.
- Store pending media locally.
- Upload when network returns.
- Patch Firestore docs after successful upload.

### Phase 5. Conflict hardening

- Review programs/meals/supplements for large-blob writes.
- Decide where "last write wins" is acceptable.
- Normalize the most dangerous structures if needed.

## Recommendation for this project

Do not start with a custom SQLite sync engine.

Start with:

1. local app bundle;
2. persistent Firestore cache;
3. unified write layer;
4. sync indicators;
5. separate offline queue only for media.

That will give the biggest result with the lowest risk and will fit the current codebase best.
