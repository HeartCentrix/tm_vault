/**
 * TMvault docs sections.
 *
 * Each export is a React component used by content.tsx. Content is grounded
 * in the TMvault codebase (parallel agents traversed the source) — file:line
 * citations point back to authoritative code so the reader can verify.
 *
 * Snapshot date: 2026-05-18.
 *
 * Long sections are intentionally not split into smaller files — keeping the
 * full reference inline makes Cmd-F search work, and the bundler tree-shakes
 * unused content automatically.
 */
import type { ReactNode } from 'react';
import { Reference } from './Reference';

const Callout = ({
  kind = 'note',
  title,
  children,
}: {
  kind?: 'note' | 'warn' | 'tip';
  title: string;
  children: ReactNode;
}) => (
  <div className={`docs-callout docs-callout--${kind}`}>
    <div className="docs-callout__title">{title}</div>
    <div>{children}</div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────
//  OVERVIEW
// ─────────────────────────────────────────────────────────────────────────
export function OverviewSection() {
  return (
    <>
      <p>
        <strong>TMvault</strong> is a purpose-built backup, recovery, and
        lifecycle-management platform for <strong>Taylor Morrison</strong>'s
        Microsoft 365 and Microsoft Azure workloads.
      </p>

      <h4>Supported workloads</h4>
      <ul>
        <li>
          <strong>Microsoft 365:</strong> Exchange Online mailboxes, OneDrive,
          SharePoint Online sites and drives, Teams chats and channels, Entra
          ID (users, groups, roles, security, audit logs, applications,
          Intune, admin units), Power BI workspaces and datasets, Power
          Platform apps/flows.
        </li>
        <li>
          <strong>Azure:</strong> Azure SQL Database (PITR + BACPAC) and
          Azure PostgreSQL Flexible Server (PITR + <code>pg_dump</code>).
        </li>
      </ul>

      <h4>Core capabilities</h4>
      <ul>
        <li>
          <strong>Incremental + delta backups</strong> via Microsoft Graph
          delta tokens, per-resource baselining, and cross-user content
          dedup (chat threads, mail bodies).
        </li>
        <li>
          <strong>Tiered retention</strong> with FLAT, GFS (Grandfather-
          Father-Son), Item-Level, and Hybrid modes; storage tiering
          (hot → cool → archive → delete) and WORM/Legal Hold support.
        </li>
        <li>
          <strong>Item-level recovery</strong> with native preview (email
          rendering, OneDrive file view, chat HTML), cross-user restore,
          and export to PST / EML / ZIP / ICS / HTML.
        </li>
        <li>
          <strong>Pluggable storage backends</strong> — Azure Blob Storage
          (multi-region, BYOK, immutability) and SeaweedFS (S3-compatible
          self-host). Hot-swappable via runtime config.
        </li>
        <li>
          <strong>Partitioned backup pipeline</strong> — OneDrive, Teams
          chats, mailboxes, SharePoint, Entra all support shard-level
          fanout across worker replicas for throughput scaling.
        </li>
        <li>
          <strong>Distributed reconciliation</strong> — lease tokens on
          jobs/snapshots/partitions prevent duplicate work; a 60-second
          reconciler reaps abandoned work bottom-up.
        </li>
      </ul>

      <h4>Engineering tenets</h4>
      <ul>
        <li>
          Every long-running task acks at message-level granularity; cancel
          must produce a clean revert, not a soft-close.
        </li>
        <li>
          Storage layer is content-addressable — same blake3 → same blob
          path → blob dedup eliminates duplicate ingress bytes for
          re-walked content.
        </li>
        <li>
          The Microsoft Graph rate-limit budget is the scarce resource;
          everything in the worker fleet is designed around minimising
          Graph calls (delta tokens, fingerprint skip, cross-user dedup,
          multi-app sharding).
        </li>
      </ul>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  ARCHITECTURE
// ─────────────────────────────────────────────────────────────────────────
export function ArchitectureSection() {
  return (
    <>
      <p>
        TMvault is a microservices system. Each tier scales horizontally
        and independently. All processes share a single Postgres database
        (<code>tm_vault</code> schema) and a single RabbitMQ broker
        (<code>tm.exchange</code>, DIRECT type, durable).
      </p>

      <h4>Tiers</h4>
      <table>
        <thead>
          <tr>
            <th>Tier</th>
            <th>Processes</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Frontend</td>
            <td><code>tm_vault</code> (React 19 + Vite)</td>
            <td>Operator UI, OAuth callbacks, recovery browser</td>
          </tr>
          <tr>
            <td>API gateway</td>
            <td><code>api_gateway</code></td>
            <td>Public ingress; routes <code>/api/v1/*</code> to backend services</td>
          </tr>
          <tr>
            <td>HTTP services</td>
            <td>
              auth, tenant, resource, job, snapshot, audit, dashboard,
              report, search, alert, graph-proxy, delta-token,
              progress-tracker
            </td>
            <td>Stateless FastAPI services; reads/writes Postgres; publishes to RabbitMQ</td>
          </tr>
          <tr>
            <td>Schedulers</td>
            <td><code>backup_scheduler</code></td>
            <td>SLA-driven backup orchestration; partition sweep; cancellation reaper</td>
          </tr>
          <tr>
            <td>Workers</td>
            <td>
              backup-worker (light + heavy), restore-worker,
              discovery-worker, chat-export-worker, azure-workload-worker
            </td>
            <td>Consume RabbitMQ; talk to Graph / Azure; write blobs + items</td>
          </tr>
          <tr>
            <td>Storage</td>
            <td>SeaweedFS pods, Azure Blob (per-tenant containers)</td>
            <td>Content-addressable blob store; backend chosen per snapshot</td>
          </tr>
          <tr>
            <td>Datastore</td>
            <td>Postgres 16</td>
            <td>OLTP source of truth for jobs/snapshots/items/audit</td>
          </tr>
        </tbody>
      </table>

      <h4>End-to-end flow — from "add datasource" to first backup</h4>
      <p>
        The full lifecycle has four phases. Phases 1–3 happen once per
        datasource; phase 4 is the recurring runtime path. Each phase
        gates the next — discovery must finish before SLAs can be
        assigned to specific users, and an SLA scope (or operator click)
        is required before a backup batch can run.
      </p>

      <h5>Phase 1 — Add datasource (M365 / Azure)</h5>
      <ol>
        <li>
          From <code>/tenants</code> the operator opens <em>Add data
          source</em> (<code>components/AddDataSourceModal.tsx</code>)
          and picks M365 or Azure. The frontend calls{' '}
          <code>tenant-service</code> to mint the Microsoft OAuth
          admin-consent URL.
        </li>
        <li>
          Operator approves admin consent in their Entra tenant. The
          redirect lands on <code>/datasource-callback</code> (M365),{' '}
          <code>/azure-datasource-callback</code> (Azure), or{' '}
          <code>/power-bi-callback</code> (Power BI). The callback page
          POSTs the auth-code to <code>tenant-service</code>.
        </li>
        <li>
          <code>tenant-service</code> exchanges the code for tokens,
          encrypts and persists them in{' '}
          <code>admin_consent_tokens</code>, inserts a{' '}
          <code>tenants</code> row with{' '}
          <code>status = PENDING_DISCOVERY</code>, then publishes a
          discovery message to <code>discovery.m365</code> or{' '}
          <code>discovery.azure</code> via{' '}
          <code>shared.message_bus.create_discovery_message()</code>.
        </li>
      </ol>

      <h5>Phase 2 — Initial discovery</h5>
      <ol>
        <li>
          A <code>discovery_worker</code> replica claims the message
          and walks the Microsoft Graph or Azure ARM API for the entire
          tenant scope (users, mailboxes, drives, SharePoint sites,
          Teams, Entra objects, Azure subscriptions / resource groups
          / databases). Rows land in{' '}
          <code>resource_discovery_staging</code> first (idempotent
          working set) and MERGE into <code>resources</code>.
        </li>
        <li>
          For each <code>ENTRA_USER</code> row, the worker publishes a
          <code>discovery.tier2</code> message that materializes the
          five Tier-2 children (<code>USER_MAIL</code>,{' '}
          <code>USER_ONEDRIVE</code>, <code>USER_CONTACTS</code>,{' '}
          <code>USER_CALENDAR</code>, <code>USER_CHATS</code>) under
          that user. Resources missing from a fresh discovery scan are
          marked <code>ARCHIVED</code>.
        </li>
        <li>
          When discovery completes, the tenant flips{' '}
          <code>PENDING_DISCOVERY → ACTIVE</code>. The frontend's
          <em>Protection</em> page polls{' '}
          <code>resource-service</code> and reveals the full resource
          tree once children exist. The UI badges users without Tier-2
          children as "Discovery pending" until the
          <code>discovery.tier2</code> fanout finishes.
        </li>
      </ol>
      <Callout kind="note" title="Why phase 2 must complete first">
        Backup jobs target Tier-2 leaves (USER_MAIL, USER_CHATS, …),
        not ENTRA_USER parents. Triggering a bulk backup before
        Tier-2 fanout finishes lands users on the{' '}
        <code>batch_pending_users</code> deferral list (see{' '}
        <code>shared/batch_pending.py</code>) — they wait for
        discovery to produce children, then a "thenBackup" chain in
        <code>discovery_worker</code> auto-resumes their backup.
      </Callout>

      <h5>Phase 3 — Define and assign SLA policies</h5>
      <ol>
        <li>
          Operator opens <em>Settings → SLA</em> and runs the multi-step
          wizard (<code>components/SlaWizard.tsx</code>). Wizard collects
          frequency (e.g. every 4h, 8h, daily), retention mode
          (FLAT / GFS / ITEM_LEVEL / HYBRID), tiered storage settings
          (hot / cool / archive), workload toggles (Mail, OneDrive,
          Chats, Calendar, Contacts), and optional BYOK encryption.
        </li>
        <li>
          Wizard POSTs to <code>resource-service</code>{' '}
          (<code>POST /sla-policies</code>); a row lands in{' '}
          <code>sla_policies</code> with the chosen configuration.
        </li>
        <li>
          Assignment happens in the Protection page: select desired users
          (single or bulk via checkbox) → <em>Apply policy</em>. The
          frontend hits{' '}
          <code>POST /resources/{`{id}`}/policy/{`{policyId}`}</code>{' '}
          (single) or{' '}
          <code>POST /resources/bulk-policy</code> (bulk). The selected
          users now have <code>resources.sla_policy_id</code> set; the
          scheduler will pick them up on the next tick.
        </li>
        <li>
          Optional: define a <em>Resource Group</em>{' '}
          (<code>resource_groups</code>) with dynamic rules (e.g. all
          users in a given department) — the matcher in{' '}
          <code>shared/resource_group_matcher.py</code> evaluates rules
          and auto-applies the group's policy as new users land via
          future discovery.
        </li>
      </ol>

      <h5>Phase 4 — Trigger and run a backup batch</h5>
      <p>
        Either the operator triggers manually (<em>Backup all</em> in
        Protection) or <code>backup_scheduler</code>'s SLA tick fires
        for the users whose next-backup-at has expired. Both paths
        converge on the same downstream flow:
      </p>
      <ol>
        <li>
          <strong>Trigger.</strong> Manual:{' '}
          <code>POST /api/v1/backups/trigger-bulk</code> →{' '}
          <code>job-service</code>. Scheduled:{' '}
          <code>backup-scheduler</code> directly calls the same
          internal helpers.
        </li>
        <li>
          <strong>Debounce.</strong>{' '}
          <code>_create_batch_backup_jobs</code> first checks for an
          <code>IN_PROGRESS</code> <code>manual_bulk</code> batch on
          the same tenant created in the last 30 s; if found, the
          duplicate trigger short-circuits and returns a pointer to
          the existing batch (no parallel run).
        </li>
        <li>
          <strong>Batch row.</strong> Inserts a <code>backup_batches</code>{' '}
          row with the operator scope (<code>scope_user_ids</code>{' '}
          excludes Tier-2 children — only ENTRA_USER ids land here, so
          the UI's "X users" count is honest).
        </li>
        <li>
          <strong>G1 dedup.</strong> Filters the requested resources
          against any IN_PROGRESS snapshot for the same resource_id in
          the last hour. Already-in-flight resources drop out so a
          repeat click doesn't re-walk them.
        </li>
        <li>
          <strong>Job fanout.</strong> Expands the scope into per-
          resource jobs and publishes one message per resource to the
          appropriate backup queue (<code>backup.urgent</code> /{' '}
          <code>backup.high</code> / <code>backup.normal</code> /{' '}
          <code>backup.low</code>, size-routed by{' '}
          <code>shared/export_routing.py</code>).
        </li>
        <li>
          <strong>Worker claim + walk.</strong> A{' '}
          <code>backup_worker</code> replica claims the message, opens
          a <code>snapshots</code> row (with an advisory lock so
          duplicate deliveries don't double-book), walks Microsoft
          Graph using the prior delta token, content-addresses each
          item, uploads new blobs (with dedup against existing
          content hashes), and writes <code>snapshot_items</code>{' '}
          rows.
        </li>
        <li>
          <strong>Partition fanout.</strong> For large workloads
          (OneDrive, Teams chats, mailboxes, SharePoint, Entra,
          Teams channels), the worker shards into per-folder /
          per-drive / per-chat / per-category partitions and
          publishes one message per shard to the matching{' '}
          <code>backup.*_partition</code> queue. Other replicas pick
          up shards in parallel. The last partition to finish runs{' '}
          <code>_finalize_partitioned_snapshot</code> to flip the
          parent snapshot to COMPLETED.
        </li>
        <li>
          <strong>Batch rollup.</strong> When all snapshots in the
          batch are terminal,{' '}
          <code>shared/batch_rollup.py:_finalize_batch_if_complete</code>{' '}
          flips <code>backup_batches.status</code> →{' '}
          COMPLETED / PARTIAL / FAILED.
        </li>
        <li>
          <strong>Audit + Activity.</strong> Every state transition
          emits an event to <code>audit.events</code>;{' '}
          <code>audit_service</code> consumes it and serves{' '}
          <code>/api/v1/activity</code> for the frontend's Activity
          page (Tasks / Audit / Risk Signals tabs).
        </li>
      </ol>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  GETTING STARTED
// ─────────────────────────────────────────────────────────────────────────
export function GettingStartedSection() {
  return (
    <>
      <h4>Prerequisites</h4>
      <ul>
        <li>Python 3.11+ and <code>pip</code> for backend services and workers</li>
        <li>Node.js 20+ and <code>npm</code> for the React frontend</li>
        <li>Postgres 16 reachable</li>
        <li>RabbitMQ 3.13+ reachable</li>
        <li>An Azure tenant with Entra ID app registrations for Microsoft Graph</li>
        <li>(Optional) Azure Storage account for production blob storage</li>
      </ul>

      <h4>Local backend</h4>
      <pre><code>{`# From repo root
cd tm_backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Copy and fill env vars (see the Environment Variables reference)
cp .env.example .env
# Edit .env — at minimum set DB_*, RABBITMQ_*, AZURE_TENANT_ID, APP_1_CLIENT_*

# Bring up dependencies (Postgres + RabbitMQ) — local docker-compose included
docker compose -f docker-compose.deps.yml up -d

# Run alembic migrations
alembic upgrade head

# Start a single service — each has its own main.py
uvicorn services.job-service.main:app --reload --port 8001`}</code></pre>

      <h4>Local frontend</h4>
      <pre><code>{`cd tm_vault
npm install
npm run dev
# → http://localhost:4200 by default (vite.config)`}</code></pre>

      <Callout kind="warn" title="Microsoft Graph apps">
        TMvault uses <strong>multiple Entra app registrations</strong>{' '}
        (<code>APP_1_*</code> through <code>APP_N_*</code>) to spread Graph
        load across separate throttling buckets. The multi-app manager
        (<code>shared/multi_app_manager.py</code>) rotates apps per-request.
        A single-app setup will hit Graph 429 throttling at moderate scale
        — at least 4 apps recommended for production. See{' '}
        <code>multi_app_manager.py</code> for the discovery contract.
      </Callout>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  ENTRA APP REGISTRATION
// ─────────────────────────────────────────────────────────────────────────
export function GraphAppSetupSection() {
  return (
    <>
      <p>
        TMvault talks to Microsoft 365 via Entra (Azure AD) app
        registrations. Production runs <strong>multiple identical
        app registrations</strong> (<code>APP_1_*</code> through{' '}
        <code>APP_N_*</code>) so the Microsoft Graph throttle budget
        is split across separate per-app per-tenant buckets. Every
        app must have <em>exactly the same</em> configuration —
        permissions, redirect URIs, and client-secret flow — only
        the client_id / client_secret differ.
      </p>

      <h4>Number of apps to create</h4>
      <p>
        Field-tested for Taylor Morrison: <strong>12 to 20 app
        registrations</strong>. The multi-app manager
        (<code>shared/multi_app_manager.py</code>) rotates apps
        per-request, marks an app <em>throttled</em> on sustained
        429 responses, and routes around it during a cool-down.
        Fewer than 4 apps will hit per-app rate limits at moderate
        scale. The exact number you need scales with peak Graph
        request rate during backup waves.
      </p>

      <h4>App basics</h4>
      <table>
        <thead><tr><th>Setting</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>Account types</td><td><strong>Single tenant</strong> — restrict to the Taylor Morrison Entra tenant (not multi-tenant)</td></tr>
          <tr><td>Authentication type</td><td>Web application + confidential client</td></tr>
          <tr><td>Client credentials</td><td>Client secret (each app has its own; rotated independently)</td></tr>
          <tr><td>Allow public client flows</td><td>No</td></tr>
          <tr><td>ID tokens</td><td>Enabled (required for OpenID Connect sign-in)</td></tr>
          <tr><td>Access tokens</td><td>Enabled</td></tr>
        </tbody>
      </table>

      <h4>Redirect URIs</h4>
      <p>
        Add all four to <em>every</em> app under{' '}
        <strong>Authentication → Platform configurations → Web →
        Redirect URIs</strong>. Replace <code>https://app.example.com</code>{' '}
        with the actual production frontend URL (the value of the{' '}
        <code>FRONTEND_URL</code> backend env var).
      </p>
      <table>
        <thead><tr><th>Path</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td><code>https://app.example.com/auth/callback</code></td><td>Operator sign-in OAuth callback (user-delegated login)</td></tr>
          <tr><td><code>https://app.example.com/datasource-callback</code></td><td>M365 datasource admin-consent return</td></tr>
          <tr><td><code>https://app.example.com/azure-datasource-callback</code></td><td>Azure (ARM) datasource OAuth return</td></tr>
          <tr><td><code>https://app.example.com/power-bi-callback</code></td><td>Power BI datasource OAuth return</td></tr>
        </tbody>
      </table>
      <p>
        For local development, also add{' '}
        <code>http://localhost:4200/auth/callback</code> and the
        three datasource callbacks. Microsoft accepts{' '}
        <code>http://localhost</code> redirects only — every other
        host must be HTTPS.
      </p>

      <h4>Front-channel logout URL</h4>
      <p>
        Optional but recommended for the operator sign-out flow:{' '}
        <code>https://app.example.com/signin</code>.
      </p>

      <h4>API permissions — Microsoft Graph</h4>
      <p>
        All permissions below are <strong>application</strong> (app-
        only) type, not delegated. Each requires <strong>tenant
        admin consent</strong> — granted in one click via the
        <em>Grant admin consent</em> button in the Entra portal, or
        through the in-app admin-consent flow at{' '}
        <code>/datasource-callback</code>.
      </p>
      <table>
        <thead>
          <tr><th>Permission</th><th>Why TMvault needs it</th></tr>
        </thead>
        <tbody>
          <tr><td><code>User.Read.All</code></td><td>Enumerate users for Tier-1 discovery; resolve user attributes for backups</td></tr>
          <tr><td><code>Group.Read.All</code></td><td>Discover Microsoft 365 groups, distribution lists, and security groups</td></tr>
          <tr><td><code>GroupMember.Read.All</code></td><td>Materialize group memberships for Entra backups</td></tr>
          <tr><td><code>Directory.Read.All</code></td><td>Tenant-wide directory metadata (roles, admin units, org branding)</td></tr>
          <tr><td><code>RoleManagement.Read.Directory</code></td><td>Snapshot directory role assignments</td></tr>
          <tr><td><code>AdministrativeUnit.Read.All</code></td><td>Discover and backup administrative units</td></tr>
          <tr><td><code>Application.Read.All</code></td><td>Snapshot app registrations + service principals</td></tr>
          <tr><td><code>Policy.Read.All</code></td><td>Conditional Access, app protection, identity protection policies</td></tr>
          <tr><td><code>AuditLog.Read.All</code></td><td>Tenant audit log ingestion (Risk Signals tab)</td></tr>
          <tr><td><code>Reports.Read.All</code></td><td>Usage reports for capacity planning + risk signals</td></tr>
          <tr><td><code>IdentityRiskyUser.Read.All</code></td><td>Risky-user signals for the Activity → Risk Signals tab</td></tr>
          <tr><td><code>IdentityRiskEvent.Read.All</code></td><td>Sign-in risk events</td></tr>
          <tr><td><code>Mail.ReadBasic.All</code></td><td>Mailbox folder + message metadata (USER_MAIL, MAILBOX, SHARED_MAILBOX, ROOM_MAILBOX, EQUIPMENT_MAILBOX)</td></tr>
          <tr><td><code>Mail.Read</code></td><td>Read message bodies + attachments for backup</td></tr>
          <tr><td><code>MailboxSettings.Read</code></td><td>Mailbox settings (timezone, language, automatic replies) for restore fidelity</td></tr>
          <tr><td><code>Calendars.Read</code></td><td>Calendar events and series-master expansion</td></tr>
          <tr><td><code>Contacts.Read</code></td><td>Personal contacts backup + restore</td></tr>
          <tr><td><code>Files.Read.All</code></td><td>OneDrive + SharePoint file content via <code>@downloadUrl</code> for Server-Side Copy</td></tr>
          <tr><td><code>Sites.Read.All</code></td><td>SharePoint sites + drives enumeration</td></tr>
          <tr><td><code>Sites.FullControl.All</code></td><td>Required for SharePoint restore + permission snapshotting (read-only is insufficient for restore)</td></tr>
          <tr><td><code>Chat.Read.All</code></td><td>1:1 + group chats + chat membership for USER_CHATS</td></tr>
          <tr><td><code>ChatMessage.Read.All</code></td><td>Chat message bodies + reactions for the tenant-singleton chat-thread store</td></tr>
          <tr><td><code>ChannelMessage.Read.All</code></td><td>Teams channel messages (TEAMS_CHANNEL backup)</td></tr>
          <tr><td><code>Team.ReadBasic.All</code></td><td>Teams listing + metadata</td></tr>
          <tr><td><code>TeamMember.Read.All</code></td><td>Team membership snapshots</td></tr>
          <tr><td><code>Channel.ReadBasic.All</code></td><td>Channel listing within teams</td></tr>
          <tr><td><code>TeamSettings.Read.All</code></td><td>Per-team settings for restore fidelity</td></tr>
          <tr><td><code>DeviceManagementConfiguration.Read.All</code></td><td>Intune configuration backups (Entra category)</td></tr>
          <tr><td><code>DeviceManagementApps.Read.All</code></td><td>Intune-managed app inventory</td></tr>
          <tr><td><code>DeviceManagementManagedDevices.Read.All</code></td><td>Intune managed-device inventory</td></tr>
        </tbody>
      </table>

      <h4>API permissions — Operator sign-in (user-delegated)</h4>
      <p>
        Used only by the <code>/api/v1/auth/microsoft/url</code>{' '}
        flow when an operator logs into the TMvault UI. These are{' '}
        <strong>delegated</strong> (user-context):
      </p>
      <table>
        <thead><tr><th>Permission</th><th>Use</th></tr></thead>
        <tbody>
          <tr><td><code>openid</code></td><td>OpenID Connect base scope</td></tr>
          <tr><td><code>profile</code></td><td>Basic profile claims</td></tr>
          <tr><td><code>email</code></td><td>Operator email for platform-user identity</td></tr>
          <tr><td><code>offline_access</code></td><td>Refresh-token issuance (single-flight refresh + 60 s proactive refresh)</td></tr>
          <tr><td><code>User.Read</code></td><td>Read the signed-in user's profile</td></tr>
        </tbody>
      </table>
      <p>
        Source: <code>auth-service/main.py:180</code> —{' '}
        <code>scope: "openid profile email offline_access User.Read"</code>.
      </p>

      <h4>API permissions — Power BI (separate app or same app)</h4>
      <p>
        Power BI uses two API audiences. Add the resources below as{' '}
        <em>application</em> permissions on the same TMvault app
        (cleanest) and grant tenant admin consent:
      </p>
      <table>
        <thead><tr><th>API</th><th>Permission</th><th>Use</th></tr></thead>
        <tbody>
          <tr><td>Power BI Service</td><td><code>Tenant.Read.All</code></td><td>Admin-API access to enumerate workspaces / datasets</td></tr>
          <tr><td>Power BI Service</td><td><code>Workspace.ReadWrite.All</code></td><td>Workspace + dataset export and restore</td></tr>
          <tr><td>Power BI Service</td><td><code>Dataset.ReadWrite.All</code></td><td>Dataset export to <code>.pbix</code> snapshot</td></tr>
          <tr><td>Microsoft Fabric</td><td><code>Workspace.ReadWrite.All</code></td><td>Fabric-era workspace operations</td></tr>
          <tr><td>Microsoft Fabric</td><td><code>Item.ReadWrite.All</code></td><td>Fabric item exports</td></tr>
        </tbody>
      </table>
      <p>
        Source:{' '}
        <code>shared/power_bi_client.py:24-37</code>. The Power BI
        Service audience is{' '}
        <code>https://analysis.windows.net/powerbi/api</code>;{' '}
        Fabric is <code>https://api.fabric.microsoft.com</code>. Both
        are resolved via <code>/.default</code> at runtime.
      </p>
      <Callout kind="warn" title="Power BI tenant-setting prerequisite">
        Power BI export requires that the Taylor Morrison tenant has
        enabled <em>Service principals can use Power BI APIs</em>{' '}
        and added the TMvault app(s) to the allowed-SPN security
        group. The <code>auth-service</code> readiness endpoint{' '}
        <code>GET /admin-consent/power-bi/readiness</code> reports
        whether this gate is satisfied.
      </Callout>

      <h4>API permissions — Azure Resource Manager (ARM)</h4>
      <p>
        For Azure SQL / PostgreSQL workloads, TMvault uses two ARM
        token audiences:
      </p>
      <table>
        <thead><tr><th>Audience</th><th>Scope</th><th>Use</th></tr></thead>
        <tbody>
          <tr><td><code>https://management.azure.com</code></td><td><code>user_impersonation offline_access</code> (delegated)</td><td>Operator-initiated Azure datasource onboarding (<code>azure-datasource-callback</code>)</td></tr>
          <tr><td><code>https://management.azure.com</code></td><td><code>.default</code> (app-only)</td><td>Server-side ARM calls (provisioning, BACPAC orchestration, restore-point list)</td></tr>
        </tbody>
      </table>
      <p>
        Source: <code>shared/azure_auth.py:53,84</code>.
      </p>

      <h4>Azure RBAC role on subscription</h4>
      <p>
        The TMvault service principal needs an Azure-side RBAC role
        assignment on each subscription (not in Entra — in the Azure
        subscription's IAM). <strong>Reader</strong> is sufficient
        for discovery and PITR-based restore;{' '}
        <strong>Contributor</strong> is needed if TMvault is allowed
        to provision new SQL / PostgreSQL servers as restore targets
        (controlled by feature flags in <code>shared/config.py</code>).
      </p>
      <p>
        <code>shared/azure_provisioning.py</code> also auto-assigns
        the TMvault service principal as the <em>Entra admin</em> of
        managed SQL / PostgreSQL servers when a backup is taken
        against them — this happens automatically and requires the
        operator's Azure datasource OAuth grant to have included{' '}
        <em>Owner</em> or <em>User Access Administrator</em> on the
        relevant resource group at consent time.
      </p>

      <h4>Client secret rotation</h4>
      <p>
        Every app has its own client secret stored in the backend
        env (<code>APP_N_CLIENT_SECRET</code>). Microsoft caps
        client-secret lifetime at 24 months. Rotate one app at a
        time:
      </p>
      <ol>
        <li>Create a new client secret in the Entra portal for the target app.</li>
        <li>Update the corresponding <code>APP_N_CLIENT_SECRET</code> env in TMvault and redeploy that service set.</li>
        <li>After the new secret is confirmed working, delete the old secret in Entra.</li>
      </ol>
      <p>
        Because the multi-app manager rotates apps per-request, you
        can rotate apps one-by-one with no backup downtime.
      </p>

      <h4>End-to-end onboarding checklist</h4>
      <ol>
        <li>Create 12 Entra app registrations (e.g. <code>TMvault App 1</code> … <code>TMvault App 12</code>) in the Taylor Morrison tenant.</li>
        <li>For each app: add the four redirect URIs.</li>
        <li>For each app: add all Microsoft Graph application permissions listed above. Add Power BI + Microsoft Fabric application permissions if Power BI backup is in scope.</li>
        <li>For each app: <em>Grant admin consent</em> in the Entra portal.</li>
        <li>For each app: generate a client secret and copy the <em>Value</em> (only visible at creation).</li>
        <li>For the global tenant: set <code>AZURE_TENANT_ID</code> to the Taylor Morrison Entra tenant id.</li>
        <li>For each app, set <code>APP_<em>N</em>_CLIENT_ID</code> and <code>APP_<em>N</em>_CLIENT_SECRET</code> in the backend env.</li>
        <li>If Power BI is in scope: enable <em>Service principals can use Power BI APIs</em> in the Power BI Admin Portal and add the TMvault app(s) to the allowed-SPN security group.</li>
        <li>If Azure SQL / PostgreSQL is in scope: assign the TMvault service principal Reader (minimum) on each in-scope Azure subscription.</li>
        <li>Boot the platform. <code>GET /admin-consent/m365/status</code> should report a stored token; <code>GET /admin-consent/azure/status</code> reports the same for Azure; <code>GET /admin-consent/power-bi/readiness</code> reports any remaining Power BI gates.</li>
      </ol>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  BACKEND SERVICES (17)
// ─────────────────────────────────────────────────────────────────────────
export function ServicesSection() {
  return (
    <>
      <p>
        Backend services live in <code>tm_backend/services/</code>. Each
        is a standalone FastAPI app with its own <code>main.py</code>.
        Behind the API gateway, they accept <code>/api/v1/*</code> routes
        for the frontend and emit RabbitMQ messages for worker tiers.
      </p>

      <Callout kind="note" title="Where are backup-worker / restore-worker / discovery-worker / chat-export-worker / azure-workload-worker?">
        The five heavy RMQ-consuming workers live in{' '}
        <code>tm_backend/workers/</code> (not <code>services/</code>) and
        are documented in the next section,{' '}
        <a href="#workers"><strong>Backend Workers</strong></a>. The
        <a href="#deployment"><strong>Deployment</strong></a> section
        also lists the complete inventory of <em>deployable processes</em>{' '}
        (24 total: 17 here + 5 workers + the heavy-pool variant{' '}
        <code>backup_worker_heavy</code> + the bundled
        <code>api_gateway</code>).
      </Callout>

      <h4>Service inventory</h4>
      <table>
        <thead>
          <tr>
            <th>Service</th>
            <th>Lines</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>job-service</code></td>
            <td>2,634</td>
            <td>Backup / restore / export job lifecycle. Bulk trigger, cancel, dedup, cascade.</td>
          </tr>
          <tr>
            <td><code>tenant-service</code></td>
            <td>1,307</td>
            <td>Datasource registration, OAuth admin consent, tenant CRUD.</td>
          </tr>
          <tr>
            <td><code>resource-service</code></td>
            <td>2,039</td>
            <td>Resource listing/filtering, SLA assignment, group rules, single-resource triggers.</td>
          </tr>
          <tr>
            <td><code>snapshot-service</code></td>
            <td>3,791</td>
            <td>Snapshot list, item browse, content streaming for previews and restores.</td>
          </tr>
          <tr>
            <td><code>audit-service</code></td>
            <td>2,803</td>
            <td>Activity feed source of truth — consumes <code>audit.events</code>; serves Tasks/Audit/Risk Signals.</td>
          </tr>
          <tr>
            <td><code>auth-service</code></td>
            <td>1,283</td>
            <td>Microsoft OAuth, JWT lifecycle, HttpOnly cookie auth, RBAC.</td>
          </tr>
          <tr>
            <td><code>backup-scheduler</code></td>
            <td>3,672</td>
            <td>SLA-driven backup tick (APScheduler), partition stale-sweep, cancellation reaper.</td>
          </tr>
          <tr>
            <td><code>dashboard-service</code></td>
            <td>723</td>
            <td>Overview metrics: protection %, 7-day chart, size deltas.</td>
          </tr>
          <tr>
            <td><code>report-service</code></td>
            <td>1,001</td>
            <td>Scheduled reports — config, history, multi-channel delivery.</td>
          </tr>
          <tr>
            <td><code>search-service</code></td>
            <td>465</td>
            <td>Full-text search across mail/files/chats/calendar.</td>
          </tr>
          <tr>
            <td><code>alert-service</code></td>
            <td>271</td>
            <td>Alert listing, ack, resolve. SLA-miss + backup-failure signals.</td>
          </tr>
          <tr>
            <td><code>graph-proxy</code></td>
            <td>369</td>
            <td>Server-side Graph proxy for previews requiring app-context.</td>
          </tr>
          <tr>
            <td><code>delta-token</code></td>
            <td>392</td>
            <td>Centralized per-resource delta-token storage and rotation.</td>
          </tr>
          <tr>
            <td><code>progress-tracker</code></td>
            <td>330</td>
            <td>Live progress for in-flight backups (best-effort cosmetic).</td>
          </tr>
          <tr>
            <td><code>dr-replication-worker</code></td>
            <td>821</td>
            <td>Cross-region blob replication for disaster recovery.</td>
          </tr>
          <tr>
            <td><code>storage_toggle_worker</code></td>
            <td>128</td>
            <td>Watches <code>system_config</code> for backend switch events.</td>
          </tr>
          <tr>
            <td><code>autoscaler</code></td>
            <td>292</td>
            <td>Reads queue depth + worker pool size, signals the orchestrator to scale replicas.</td>
          </tr>
        </tbody>
      </table>

      <h4>Per-service detail</h4>
      <p>
        Concise reference for each service. The full endpoint list per
        service (209 endpoints across the 17 services) is at the end of
        this section.
      </p>

      <h5>job-service</h5>
      <p>
        The most-touched service. Critical endpoints (FastAPI routes in
        <code>services/job-service/main.py</code>):
      </p>
      <ul>
        <li><code>POST /api/v1/backups/trigger</code> — single-resource backup</li>
        <li><code>POST /api/v1/backups/trigger-bulk</code> — bulk backup (the big one)</li>
        <li><code>POST /api/v1/backups/trigger-user/{`{id}`}</code> — per-user fanout</li>
        <li><code>POST /api/v1/jobs/{`{job_id}`}/cancel</code> — cancel + full revert</li>
        <li><code>GET /api/v1/jobs/{`{job_id}`}</code> — job status</li>
        <li><code>POST /api/v1/restore</code> — single-resource restore / export</li>
      </ul>
      <p>
        Two defenses on cancel: a <code>pg_advisory_xact_lock</code> keyed
        on <code>batch_id</code> serializes concurrent sibling cancels
        (avoids 3-way Postgres deadlock observed in prod), and a sweep at
        <code>backup-scheduler:1019</code> reaps blobs + items + snapshot
        rows for every snapshot marked <code>cancelled_at</code> in
        <code>extra_data</code> — including COMPLETED snapshots whose
        owner job got cancelled in the race window.
      </p>

      <h5>backup-scheduler</h5>
      <p>
        APScheduler-driven. Key periodic jobs (sites in
        <code>services/backup-scheduler/main.py</code>):
      </p>
      <ul>
        <li>SLA tick — every minute; finds resources whose next backup is due</li>
        <li>Tier-2 backstop — re-enqueues discovery for stale tenants</li>
        <li>Partition sweep — every 30s; re-publishes stale partition messages whose parent job is still alive</li>
        <li>Stuck-RUNNING job reaper — every minute; reaps jobs whose snapshots all finished but no finalize hook fired</li>
        <li>Cancelled-snapshot sweep — every 30s; the destructive teardown step for cancelled work</li>
      </ul>

      <h5>tenant-service</h5>
      <p>
        Datasource registration and OAuth admin-consent. Builds the
        Microsoft admin-consent URL, exchanges the auth code for
        tokens, encrypts and persists them in{' '}
        <code>admin_consent_tokens</code>, and inserts the tenant row
        with <code>status = PENDING_DISCOVERY</code>. Also publishes
        the initial <code>discovery.*</code> message that kicks off
        Phase 2 of the lifecycle.
      </p>
      <ul>
        <li><strong>Endpoints (26):</strong> tenant CRUD, OAuth URL builders, callback exchanges, admin-consent status, M365 / Azure / Power BI datasource lifecycle.</li>
        <li><strong>Tables:</strong> <code>tenants</code>, <code>admin_consent_tokens</code>, <code>tenant_secrets</code>.</li>
        <li><strong>Publishes to:</strong> <code>discovery.m365</code>, <code>discovery.azure</code>.</li>
      </ul>

      <h5>resource-service</h5>
      <p>
        The catalog. Powers the Protection page. Lists, filters, and
        paginates resources; assigns SLA policies (single or bulk);
        evaluates resource-group rules; triggers per-resource backups
        or discovery refreshes.
      </p>
      <ul>
        <li><strong>Endpoints (31):</strong> resource list / get / filter, SLA policy CRUD + assignment, resource-group CRUD + rule evaluation, single-resource backup / discovery trigger, Tier-2 expansion.</li>
        <li><strong>Tables:</strong> <code>resources</code>, <code>sla_policies</code>, <code>sla_exclusions</code>, <code>resource_groups</code>, <code>group_policy_assignments</code>.</li>
        <li><strong>Publishes to:</strong> <code>discovery.tier2</code> (when an operator triggers a per-user re-discovery).</li>
      </ul>

      <h5>snapshot-service</h5>
      <p>
        Read-mostly surface for the Recovery and snapshot-browse views.
        32 endpoints — the most of any service — because it serves
        multiple workload-specific browsers (mail folder tree, OneDrive
        directory listings, chat thread index, calendar event view,
        contacts list).
      </p>
      <ul>
        <li><strong>Endpoints (32):</strong> snapshot list by resource, item browse (paginated, filtered), content streaming for previews, per-workload sub-routes (mail / onedrive / chats / calendar / contacts), size summary, batch-id grouping.</li>
        <li><strong>Tables:</strong> <code>snapshots</code>, <code>snapshot_items</code>, <code>snapshot_partitions</code>.</li>
      </ul>

      <h5>audit-service</h5>
      <p>
        The Activity feed's source of truth. Consumes the{' '}
        <code>audit.events</code> RMQ queue and persists rows to{' '}
        <code>audit_events</code>; serves the Tasks / Audit / Risk
        Signals tabs. Runs four async background loops:{' '}
        <code>consume_audit_events</code>,{' '}
        <code>_refresh_running_jobs</code>,{' '}
        <code>_chat_integrity_loop</code>,{' '}
        <code>_archived_purge_loop</code>.
      </p>
      <ul>
        <li><strong>Endpoints (18):</strong> activity / audit / risk-signals listings, cancel, CSV export, single-row detail, batch-grouped views (with the same <code>_batch_group_key</code> helper used by dashboard-service for consistency).</li>
        <li><strong>Consumes:</strong> <code>audit.events</code>.</li>
        <li><strong>Tables:</strong> <code>audit_events</code>, <code>backup_batches</code>, <code>jobs</code>, <code>snapshots</code>.</li>
      </ul>

      <h5>auth-service</h5>
      <p>
        Microsoft OAuth orchestrator + JWT lifecycle. Issues HttpOnly
        access-token cookies (JS-unreadable, XSS-proof) and tracks a
        non-credential <code>user</code> breadcrumb in localStorage
        for UX. Single-flight refresh on 401; proactive refresh 60 s
        before token expiry (frontend reads{' '}
        <code>access_token_expires_at</code> cookie).
      </p>
      <ul>
        <li><strong>Endpoints (16):</strong> OAuth URL, OAuth callback, refresh, logout, me, admin-consent status (M365 / Azure / Power BI readiness).</li>
        <li><strong>RBAC:</strong> decorators in <code>shared/security.py</code> enforce role (SUPER_ADMIN, ORG_ADMIN, TENANT_ADMIN, …) on every protected endpoint.</li>
        <li><strong>JWT algorithm:</strong> HS256 (hardcoded in <code>shared/config.py</code> — not env-overridable).</li>
      </ul>

      <h5>dashboard-service</h5>
      <p>
        Aggregations for the Overview page: protection %, 7-day backup
        bar chart, size summary with 1-day / 1-month deltas, total
        items backed up, per-workload breakdown. Reuses{' '}
        <code>_batch_group_key</code> + <code>_roll_up_group_outcome</code>{' '}
        with audit-service so "one click = one task" semantics are
        consistent between Activity and Dashboard.
      </p>
      <ul>
        <li><strong>Endpoints (6):</strong> <code>/dashboard/overview</code>, <code>/dashboard/protection</code>, <code>/dashboard/size-summary</code>, <code>/status/24hour</code>, <code>/status/7day</code>, <code>/health</code>.</li>
        <li><strong>Tables:</strong> <code>resources</code>, <code>snapshots</code>, <code>jobs</code>, <code>backup_batches</code> (read-only).</li>
      </ul>

      <h5>report-service</h5>
      <p>
        Scheduled reports — daily / weekly / monthly. Operator-defined
        schedules persisted in <code>report_configs</code>; history
        of past sends in <code>report_history</code> with per-channel
        delivery status (email, Slack, Teams, Google Chat).
      </p>
      <ul>
        <li><strong>Endpoints (8):</strong> config CRUD, history listing, manual send / test send.</li>
        <li><strong>Tables:</strong> <code>report_configs</code>, <code>report_history</code>.</li>
        <li><strong>External:</strong> SMTP for email; webhook URLs for Slack / Teams / Google Chat.</li>
      </ul>

      <h5>search-service</h5>
      <p>
        Full-text search across backed-up mail bodies, OneDrive file
        names + content, chat messages, calendar events. Powers the
        Global Search page. Currently uses Postgres FTS;{' '}
        <code>ELASTICSEARCH_ENABLED</code> is hardcoded <code>False</code>{' '}
        in <code>shared/config.py</code>.
      </p>
      <ul>
        <li><strong>Endpoints (4):</strong> <code>POST /search</code> (workload-scoped), workload type list, plus health.</li>
        <li><strong>Tables:</strong> <code>snapshot_items</code> with GIN index on extracted text.</li>
      </ul>

      <h5>alert-service</h5>
      <p>
        SLA-miss + backup-failure signals. Most surface area is
        stubbed scaffolding for future expansion (webhooks,
        notification settings, IP restrictions, self-service
        settings, member management).
      </p>
      <ul>
        <li><strong>Endpoints (20):</strong> alert listing / ack / resolve plus stubbed scaffolding routes.</li>
        <li><strong>Tables:</strong> <code>alerts</code>.</li>
      </ul>

      <h5>graph-proxy</h5>
      <p>
        Server-side Microsoft Graph proxy for previews that must run
        in app-context (e.g. an inline-image fetch where the browser
        has no app credentials). The frontend hits this service
        instead of Graph directly so it doesn't have to manage
        tokens client-side.
      </p>
      <ul>
        <li><strong>Endpoints (6):</strong> preview-content fetchers (mail body, attachment, chat hosted-content, file download URL handoff) + health.</li>
        <li><strong>External:</strong> Microsoft Graph via the multi-app rotation.</li>
      </ul>

      <h5>delta-token</h5>
      <p>
        Centralized delta-token storage and rotation. Per-resource
        delta tokens decouple worker restarts from token loss —
        workers read from / write to this service rather than
        carrying state in memory.
      </p>
      <ul>
        <li><strong>Endpoints (6):</strong> get / set per resource + per-folder, rotate, health.</li>
        <li><strong>Auth:</strong> only service in the fleet that requires <code>X-Internal-Api-Key</code> shared-secret (<code>require_internal_api_key</code>); fail-closed if <code>INTERNAL_API_KEY</code> is unset.</li>
        <li><strong>Tables:</strong> <code>mail_folder_delta</code>, <code>sharepoint_drive_delta</code>, plus the <code>delta_token</code> column on <code>snapshots</code>.</li>
      </ul>

      <h5>progress-tracker</h5>
      <p>
        Live progress for in-flight backups. Best-effort cosmetic —
        the UI displays a percentage while a backup is running but
        the authoritative progress is derived at read time from the
        snapshots table.
      </p>
      <ul>
        <li><strong>Endpoints (6):</strong> per-job progress get / set, pre-scan total estimate, health.</li>
        <li><strong>Tables:</strong> <code>jobs.progress_pct</code> (legacy column kept for back-compat).</li>
      </ul>

      <h5>dr-replication-worker</h5>
      <p>
        Cross-region blob replication for disaster recovery. Two
        independent loops:
      </p>
      <ul>
        <li>
          <strong>Snapshot blob replication</strong> — 5-minute loop;
          finds snapshots in <code>dr_replication_status='PENDING'</code>{' '}
          and copies their blobs server-side to the DR-region storage
          account.
        </li>
        <li>
          <strong>Chat-singleton PG replication</strong> — 10-minute
          loop; replicates <code>chat_threads</code> +{' '}
          <code>chat_thread_messages</code> rows from primary to DR
          Postgres via <code>DR_PG_DSN</code>. No-op when{' '}
          <code>DR_PG_DSN</code> is unset.
        </li>
      </ul>
      <p>Pure worker — no HTTP surface (0 endpoints).</p>

      <h5>storage_toggle_worker</h5>
      <p>
        Watches <code>system_config</code> for backend-switch events.
        Single-active-instance guarantee via Postgres advisory lock
        ID <code>9_042_042</code> — the only service in the fleet
        that uses an advisory lock for instance leader election.
        Pure worker (0 endpoints).
      </p>
      <ul>
        <li><strong>Tables:</strong> <code>system_config</code>, <code>storage_backends</code>, <code>storage_toggle_events</code>.</li>
      </ul>

      <h5>autoscaler</h5>
      <p>
        Queue-depth-driven replica autoscaler. Polls the RabbitMQ
        management API for per-queue depth and calls the orchestrator
        scaling API to adjust replica counts. Per-service config with
        min / max / target-depth + hysteresis to prevent flapping.
        Pure worker (0 endpoints).
      </p>

      <h4>Per-service reference</h4>
      <p>
        Exhaustive per-service detail — every <code>@app.</code> route,
        env vars referenced, dependencies, notable patterns — extracted
        directly from the source:
      </p>
      <Reference file="services.md" />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  BACKEND WORKERS (5)
// ─────────────────────────────────────────────────────────────────────────
export function WorkersSection() {
  return (
    <>
      <p>
        Workers consume RabbitMQ messages and drive the actual data
        movement against Microsoft Graph and Azure. They live in{' '}
        <code>tm_backend/workers/</code>. Five worker codebases; six
        deployable processes (<code>backup_worker</code> is deployed
        twice — once as the light pool and once as{' '}
        <code>backup_worker_heavy</code> with{' '}
        <code>BACKUP_WORKER_DEDICATED_ONLY=true</code> so big
        OneDrive / mailbox jobs stay isolated from urgent / high
        traffic).
      </p>
      <Callout kind="note" title="Related sections">
        Smaller worker-style processes that don't talk to Graph
        directly (<code>autoscaler</code>,{' '}
        <code>dr_replication</code>, <code>storage_toggle_worker</code>)
        live in <code>tm_backend/services/</code> and are documented
        in <a href="#services"><strong>Backend Services</strong></a>.
        For the complete list of <em>everything deployed</em>, see{' '}
        <a href="#deployment"><strong>Deployment</strong></a>.
      </Callout>

      <h4>Worker inventory</h4>
      <table>
        <thead>
          <tr>
            <th>Worker</th>
            <th>Lines</th>
            <th>Queues consumed</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>backup-worker</code></td>
            <td>22,314</td>
            <td>
              <code>backup.urgent</code>, <code>backup.high</code>,{' '}
              <code>backup.normal</code>, <code>backup.low</code> +{' '}
              <code>backup.onedrive_partition</code>,{' '}
              <code>backup.chats_partition</code>,{' '}
              <code>backup.mail_partition</code>,{' '}
              <code>backup.sharepoint_partition</code>,{' '}
              <code>backup.groups_partition</code>,{' '}
              <code>backup.entra_partition</code>
            </td>
          </tr>
          <tr>
            <td><code>restore-worker</code></td>
            <td>4,574</td>
            <td><code>restore.urgent</code>, <code>restore.normal</code>, <code>restore.low</code></td>
          </tr>
          <tr>
            <td><code>discovery-worker</code></td>
            <td>1,471</td>
            <td><code>discovery.m365</code>, <code>discovery.azure</code>, <code>discovery.tier2</code></td>
          </tr>
          <tr>
            <td><code>chat-export-worker</code></td>
            <td>134</td>
            <td><code>q.export.chat.thread</code>, <code>q.export.chat.parent</code>, <code>q.export.chat.merge</code></td>
          </tr>
          <tr>
            <td><code>azure-workload-worker</code></td>
            <td>480</td>
            <td><code>azure.vm</code>, <code>azure.sql</code>, <code>azure.postgres</code> + their <code>azure.restore.*</code> twins</td>
          </tr>
        </tbody>
      </table>

      <h4>backup-worker</h4>
      <p>
        The flagship process — 22K lines, 25+ resource-type handlers,
        partition fanout, server-side blob copy, content-addressed dedup,
        delta-token bookkeeping, distributed lease management, and a
        per-queue dedicated channel topology so high-volume lanes
        (mail/onedrive partitions) don't starve light lanes.
      </p>
      <p>Key constructs in <code>workers/backup-worker/main.py</code>:</p>
      <ul>
        <li>
          <code>_HANDLER_TABLE</code> at <code>line 2829</code> — dispatch
          map keyed on resource type (USER_CHATS, MAILBOX, ONEDRIVE, etc.)
        </li>
        <li>
          <code>consume_queue</code> at <code>line 2262</code> — entry point
          per queue with a <code>asyncio.Semaphore</code> sized to prefetch
        </li>
        <li>
          <code>process_backup_message</code> at <code>line 2739</code> —
          dispatches by message kind (BACKUP, BACKUP_*_PARTITION, etc.)
        </li>
        <li>
          Mass backup fanout at <code>line 3263</code> — publishes per-
          resource messages so a single bulk-trigger can saturate a
          worker fleet
        </li>
        <li>
          <code>_finalize_partitioned_snapshot</code> — last shard wins;
          drains pending FILE_VERSION rows before flipping snapshot
          status to COMPLETED to avoid ✓ UI before partitions actually
          finish
        </li>
      </ul>

      <h4>Concurrency model</h4>
      <ul>
        <li>
          <code>backup_semaphore</code> (default 8) — file streams per
          NIC; controls outbound HTTPS concurrency
        </li>
        <li>
          <code>copy_semaphore</code> (default 20) — Azure Storage
          ingress (Server-Side Copy fanout)
        </li>
        <li>
          <code>_onedrive_backup_semaphore</code> — per-worker OneDrive
          concurrency cap (<code>MAX_CONCURRENT_ONEDRIVE_BACKUPS_PER_WORKER</code>)
        </li>
        <li>
          <code>_tenant_backup_semaphores</code> — per-tenant fairness;
          lazily allocated on first message for a tenant
        </li>
        <li>
          <code>handler_sem</code> — per-queue concurrent tasks ceiling,
          sized to the queue's prefetch
        </li>
      </ul>

      <h4>Cancellation</h4>
      <p>
        Three race outcomes are handled (and were each the subject of
        production fixes):
      </p>
      <ol>
        <li>
          <strong>Worker still mid-walk</strong> → polls{' '}
          <code>_is_job_cancelled</code> between resources/items;
          raises <code>JobCancelledMidFlight</code>; existing
          IN_PROGRESS row → FAILED via cancel flip.
        </li>
        <li>
          <strong>Worker finalizes after cancel commits</strong> →
          <code>_coerce_snapshot_terminal_on_cancel</code> at finalize
          stamps FAILED instead of COMPLETED, so the row is excluded
          from the next incremental's delta-from-prior calc.
        </li>
        <li>
          <strong>Worker finalizes before cancel commits</strong> →
          <code>cancel_job</code> writes{' '}
          <code>extra_data.cancelled_at</code> on every
          COMPLETED/PARTIAL snapshot owned by the cancelled job; the
          sweep at <code>backup-scheduler:1019</code> reaps blobs +
          items + the snapshot row.
        </li>
      </ol>

      <h4>restore-worker</h4>
      <p>
        Three priority queues (<code>restore.urgent/normal/low</code>),
        type-specific engines for IN_PLACE / CROSS_USER / EXPORT_PST /
        EXPORT_ZIP / DOWNLOAD. Contact restore uses both a global
        semaphore (<code>CONTACT_RESTORE_GLOBAL_POOL</code>) and per-user
        semaphores (lazily allocated) — large contact restores hammer the
        per-mailbox <code>$batch</code> ceiling otherwise.
      </p>

      <h4>discovery-worker</h4>
      <p>
        Three queues: <code>discovery.m365</code> (tenant-wide
        enumeration), <code>discovery.azure</code>, and{' '}
        <code>discovery.tier2</code> (per-user fanout that materializes
        the five USER_* child resources). Uses a staging table
        (<code>resource_discovery_staging</code>) for idempotent
        upsert; resources missing from the latest discovery are marked
        ARCHIVED. Optional <code>discoveryScope</code> filters allow
        partial discovery (users only, drives only, etc.).
      </p>

      <h4>chat-export-worker</h4>
      <p>
        Single instance, <code>prefetch=1</code>, serialized. Streams a
        chat thread + parent metadata + merged hosted contents into a
        single ZIP for download. On startup, reclaims orphan jobs that
        were RUNNING/PENDING/QUEUED from a previous replica's crash and
        marks them FAILED.
      </p>

      <h4>azure-workload-worker</h4>
      <p>
        Isolated from the M365 worker fleet so long Azure LROs
        (BACPAC exports, <code>pg_dump</code>) don't starve Graph
        throughput. Two workloads in scope — Azure SQL (PITR /
        SCHEMA_ONLY / FULL) and Azure PostgreSQL (PITR /{' '}
        <code>pg_dump</code>) — each with low prefetch (2-5) reflecting
        LRO duration.
      </p>

      <h4>Per-worker reference</h4>
      <p>
        Exhaustive per-worker reference — queues, message kinds,
        processing flow, concurrency model, env vars, dependencies,
        notable algorithms — extracted from source:
      </p>
      <Reference file="workers.md" />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  DATA MODEL
// ─────────────────────────────────────────────────────────────────────────
export function DataModelSection() {
  return (
    <>
      <p>
        Authoritative source is{' '}
        <code>tm_backend/shared/models.py</code>. 32 tables, 11 enums,
        350+ columns, 3 alembic migrations on the baseline-from-2026-05-17
        schema.
      </p>

      <h4>Enums</h4>
      <table>
        <thead>
          <tr><th>Enum</th><th>Values</th><th>Notes</th></tr>
        </thead>
        <tbody>
          <tr><td><code>UserRole</code></td><td>SUPER_ADMIN, ORG_ADMIN, TENANT_ADMIN, BACKUP_OPERATOR, RESTORE_OPERATOR, CONTENT_VIEWER, USER</td><td>RBAC tiers</td></tr>
          <tr><td><code>TenantType</code></td><td>M365, AZURE</td><td>Datasource flavor</td></tr>
          <tr><td><code>TenantStatus</code></td><td>PENDING, ACTIVE, DISCONNECTED, SUSPENDED, PENDING_DELETION, DISCOVERING, PENDING_DISCOVERY</td><td>Tenant lifecycle</td></tr>
          <tr><td><code>ResourceType</code></td><td>40+ values — see file</td><td>Workload kind (USER_MAIL, ONEDRIVE, USER_CHATS, TEAMS_CHANNEL, AZURE_VM, …)</td></tr>
          <tr><td><code>ResourceStatus</code></td><td>DISCOVERED, ACTIVE, ARCHIVED, SUSPENDED, PENDING_DELETION, INACCESSIBLE</td><td>Per-resource state</td></tr>
          <tr><td><code>JobType</code></td><td>BACKUP, RESTORE, EXPORT, DISCOVERY, DELETE</td><td>Top-level job kind</td></tr>
          <tr><td><code>JobStatus</code></td><td>QUEUED, PENDING, RUNNING, COMPLETED, FAILED, CANCELLED, CANCELLING, RETRYING</td><td>Job lifecycle</td></tr>
          <tr><td><code>SnapshotType</code></td><td>FULL, INCREMENTAL, PREEMPTIVE, MANUAL</td><td>Per-snapshot kind</td></tr>
          <tr><td><code>SnapshotStatus</code></td><td>IN_PROGRESS, COMPLETED, FAILED, PARTIAL, PENDING_DELETION</td><td>Note: no CANCELLED — cancelled snapshots are marked FAILED + <code>extra_data.cancelled_at</code></td></tr>
          <tr><td><code>StorageBackendKind</code></td><td>azure_blob, seaweedfs</td><td>Pluggable backend selector</td></tr>
          <tr><td><code>TransitionState</code> / <code>ToggleStatus</code></td><td>Multi-step backend swap state machine</td><td>Storage hot-swap orchestration</td></tr>
        </tbody>
      </table>

      <h4>Core hierarchy</h4>
      <p>
        Top-down: <code>Organization → Tenant → Resource</code>. Resources
        form a two-tier tree: <code>ENTRA_USER</code> parents own five
        Tier-2 children (USER_MAIL, USER_ONEDRIVE, USER_CONTACTS,
        USER_CALENDAR, USER_CHATS) via <code>parent_resource_id</code>.
        Backup jobs target the leaf Tier-2 resources.
      </p>

      <h4>Backup lifecycle tables</h4>
      <ul>
        <li>
          <code>backup_batches</code> — operator-intent row created on
          every manual bulk-backup click. Records scope, status, and
          serves as the Activity feed source of truth.
        </li>
        <li>
          <code>jobs</code> — async work unit (24 cols). Stores spec,
          attempts, lease (for distributed reconciliation), live
          rollup from snapshots, storage-toggle retry plumbing.
        </li>
        <li>
          <code>snapshots</code> — point-in-time backup (38 cols). HC
          drain status, DR replication state, reuse chain (chain root +
          parent pointer), lease, blob_path, content_checksum,
          extra_data jsonb for sidecar markers (e.g.{' '}
          <code>cancelled_at</code>, <code>finalize_cancelled</code>,{' '}
          <code>partition_reconciled</code>).
        </li>
        <li>
          <code>snapshot_items</code> — leaf record per backed-up item
          (19 cols). Points at dedup stores (<code>mail_message_bodies</code>
          for cross-user mail dedup, <code>chat_thread_messages</code> for
          per-thread chat dedup). <code>backend_id</code> per row so
          storage toggle can re-target without rewriting items.
        </li>
        <li>
          <code>snapshot_partitions</code> — per-shard tracking for
          partitioned backups (25 cols). Atomic claim + stale-sweep;
          status, failure state, payload (chat_ids / folder_ids /
          drive_ids / channel_ids / category_ids).
        </li>
      </ul>

      <h4>Cross-user dedup tables (2026-05-13 & 2026-05-17)</h4>
      <ul>
        <li>
          <code>chat_threads</code> — singleton per (tenant, chat_id);
          drain claim, cursor, completeness baseline. Reused by every
          user's USER_CHATS snapshot within the 7h freshness window.
        </li>
        <li>
          <code>chat_thread_messages</code> — drained-once-per-batch
          messages with full Graph payload in <code>metadata_raw</code>.
        </li>
        <li>
          <code>mail_message_bodies</code> — cross-user mail dedup;
          fingerprint-based; <code>ref_count</code> tracking.
        </li>
        <li>
          <code>chat_url_cache</code> — tenant-scoped cache of SharePoint
          URLs → driveItem (SHA-256 keyed).
        </li>
      </ul>

      <h4>SLA / policy tables</h4>
      <ul>
        <li>
          <code>sla_policies</code> — 80+ cols. Frequency, retention
          modes (FLAT/GFS/ITEM_LEVEL/HYBRID), tiered storage
          (hot/cool/archive), BYOK encryption, auto-apply rules.
        </li>
        <li>
          <code>sla_exclusions</code> — per-policy exclusion rules
          (folder paths, file extensions, regex).
        </li>
        <li>
          <code>resource_groups</code> — dynamic rule-based or static
          grouping with priority.
        </li>
        <li>
          <code>group_policy_assignments</code> — group ↔ policy join.
        </li>
      </ul>

      <h4>Storage backend tables (2026-04-21)</h4>
      <ul>
        <li>
          <code>storage_backends</code> — pluggable provider rows
          (Azure Blob, SeaweedFS); kind-specific config jsonb.
        </li>
        <li>
          <code>system_config</code> — singleton (id=1). Active
          backend id + transition state + cooldown window.
        </li>
        <li>
          <code>storage_toggle_events</code> — immutable audit of
          backend swaps; granular status (drain → flip → smoke tests).
        </li>
      </ul>

      <h4>Migrations</h4>
      <ul>
        <li><code>20260517_0001_baseline.py</code> — initial schema</li>
        <li><code>20260517_0002_partition_big_tables.py</code> — partitioning optimization</li>
        <li><code>20260517_0003_chat_drain_completeness_baseline.py</code> — chat completeness tracking</li>
      </ul>

      <h4>Full table-by-table reference</h4>
      <p>
        Every column, FK, index, enum value for all 38 tables (548
        columns total), grounded in <code>models.py</code>:
      </p>
      <Reference file="datamodel.md" />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  SHARED MODULES
// ─────────────────────────────────────────────────────────────────────────
export function SharedModulesSection() {
  return (
    <>
      <p>
        Shared library at <code>tm_backend/shared/</code>. 59 modules
        across 9 domains, 400+ public APIs. Every service and worker
        imports from this tree.
      </p>

      <h4>Microsoft Graph integration</h4>
      <table>
        <thead><tr><th>Module</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td><code>graph_client.py</code></td><td>Main Graph API client. Priority-based rate limiting, context-aware scheduling, throttle-aware retry.</td></tr>
          <tr><td><code>graph_batch.py</code></td><td><code>$batch</code> wrapper bundling up to 20 GET requests per HTTP call.</td></tr>
          <tr><td><code>graph_entra.py</code></td><td>Entra-specific wrappers (users, groups, CA policies, admin units) with typed PATCH/POST helpers.</td></tr>
          <tr><td><code>graph_priority.py</code></td><td>Maps RabbitMQ queue names to Graph priority (NORMAL / HIGH / URGENT).</td></tr>
          <tr><td><code>graph_rate_limiter.py</code></td><td>Process-global token bucket per tenant; Redis coordination optional.</td></tr>
          <tr><td><code>graph_ratelimit.py</code></td><td>Retry/backoff policy — exponential backoff + jitter.</td></tr>
          <tr><td><code>_graph_retry.py</code></td><td>HTTP 429/5xx classifier.</td></tr>
          <tr><td><code>multi_app_manager.py</code></td><td>Distributes requests across 12+ app registrations; circuit breaker for banned apps.</td></tr>
          <tr><td><code>tier2_discovery.py</code></td><td>Materializes USER_MAIL/ONEDRIVE/CONTACTS/CALENDAR/CHATS under ENTRA_USER.</td></tr>
        </tbody>
      </table>

      <h4>Storage</h4>
      <table>
        <thead><tr><th>Module</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td><code>storage/router.py</code></td><td>DB-driven backend registry; LISTEN/NOTIFY for runtime swaps.</td></tr>
          <tr><td><code>storage/base.py</code></td><td><code>BackendStore</code> protocol definition.</td></tr>
          <tr><td><code>storage/azure_blob.py</code></td><td>Azure Blob implementation wrapping <code>AzureStorageShard</code>.</td></tr>
          <tr><td><code>storage/seaweedfs.py</code></td><td>S3-compatible backend via aioboto3; ObjectLock support.</td></tr>
          <tr><td><code>azure_storage.py</code></td><td>High-performance Azure Blob — Server-Side Copy, multipart, WORM, lifecycle, CMK, legal holds.</td></tr>
          <tr><td><code>azure_immutability.py</code></td><td>WORM policies, legal holds, version-level immutability.</td></tr>
          <tr><td><code>blob_dedup.py</code></td><td>Content-addressable dedup with in-process TTL-LRU cache.</td></tr>
          <tr><td><code>storage_bootstrap.py</code></td><td>Idempotent backend + system_config initialization.</td></tr>
        </tbody>
      </table>

      <h4>Backup-flow helpers</h4>
      <table>
        <thead><tr><th>Module</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td><code>backup_checkpoint.py</code></td><td>Per-job OneDrive checkpoint (delta tokens + commit cadence).</td></tr>
          <tr><td><code>batch_pending.py</code></td><td>State machine + pure logic for batch scope classification (ready vs deferred).</td></tr>
          <tr><td><code>batch_rollup.py</code></td><td>Derives batch terminal status from job/snapshot/partition states (gate-1 + gate-2).</td></tr>
          <tr><td><code>lease.py</code></td><td>Atomic lease claim + renewal with fence tokens.</td></tr>
          <tr><td><code>reclaim.py</code></td><td>Startup re-release of expired leases.</td></tr>
          <tr><td><code>reconciler.py</code></td><td>Bottom-up orphan finalization every 60s.</td></tr>
          <tr><td><code>retention.py</code></td><td>Retention-until + immutability-mode computation.</td></tr>
          <tr><td><code>retention_cleanup.py</code></td><td>Daily snapshot expiry deletion (FLAT/GFS/HYBRID).</td></tr>
          <tr><td><code>snapshot_reuse.py</code></td><td>Reuse-snapshot chain resolution (pointer-based dedup).</td></tr>
        </tbody>
      </table>

      <h4>Routing / dispatch</h4>
      <table>
        <thead><tr><th>Module</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td><code>export_routing.py</code></td><td>Routes export/backup jobs to normal vs heavy worker pools by size/type.</td></tr>
          <tr><td><code>routing_fence.py</code></td><td>Defends against wrong-queue delivery; re-publishes up to 2 hops.</td></tr>
          <tr><td><code>folder_resolver.py</code></td><td>Single-query resolver for mixed file selections.</td></tr>
          <tr><td><code>resource_group_matcher.py</code></td><td>Evaluates resource-group rules (field/operator/value matching).</td></tr>
        </tbody>
      </table>

      <h4>Observability</h4>
      <ul>
        <li><code>audit.py</code> — centralized audit-event emission (fire-and-forget HTTP POST to audit-service).</li>
        <li><code>core_metrics.py</code> — Prometheus metrics for jobs, latency, cost telemetry.</li>
        <li><code>memory_monitor.py</code> — soft-shutdown trigger on RSS breach.</li>
        <li><code>pst_metrics.py</code> / <code>sla_metrics.py</code> — domain-specific metric series, lazy-init.</li>
      </ul>

      <h4>Misc</h4>
      <ul>
        <li><code>config.py</code> — Pydantic BaseSettings; central env-var truth.</li>
        <li><code>mbox_writer.py</code> — RFC 4155 mboxrd streaming writer with rollover.</li>
        <li><code>mime_builder.py</code> — RFC 5322 multipart EML builder from Graph payloads.</li>
        <li><code>file_path_sanitize.py</code> — Windows-safe ZIP arcname sanitization.</li>
        <li><code>power_bi_client.py</code>, <code>power_platform_client.py</code> — admin-API clients.</li>
      </ul>

      <h4>Full module reference (60+ modules)</h4>
      <p>
        Exhaustive module-by-module breakdown with public symbols and
        their one-line summaries:
      </p>
      <Reference file="shared.md" />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  MESSAGE BUS
// ─────────────────────────────────────────────────────────────────────────
export function MessageBusSection() {
  return (
    <>
      <p>
        Single DIRECT exchange <code>tm.exchange</code> backed by
        durable queues. 31 queues across backup / restore / discovery /
        azure / utility families. Every queue has a corresponding{' '}
        <code>*.dlq</code> dead-letter queue.
      </p>

      <h4>Connection</h4>
      <p>
        Configured via <code>RABBITMQ_*</code> env vars (see Env Vars
        reference). Notable:
      </p>
      <ul>
        <li>
          <code>RABBITMQ_CONSUMER_HEARTBEAT_SECONDS</code> = 604800
          (7 days) — bumped to prevent mid-backup redelivery
        </li>
        <li>
          <code>RABBITMQ_CONSUMER_TIMEOUT_MS</code> = 604800000
          (7 days) — max broker wait before auto-redelivery
        </li>
        <li>Default prefetch = 50 (per-queue channels override)</li>
      </ul>

      <h4>Backup queue family</h4>
      <table>
        <thead><tr><th>Queue</th><th>Prefetch</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td><code>backup.urgent</code></td><td>8</td><td>User-initiated and urgent SLA backups</td></tr>
          <tr><td><code>backup.high</code></td><td>10</td><td>Scheduled bulk-trigger jobs</td></tr>
          <tr><td><code>backup.normal</code></td><td>20</td><td>Default tier; heavy pool separated when <code>BACKUP_WORKER_DEDICATED_ONLY=true</code></td></tr>
          <tr><td><code>backup.low</code></td><td>50</td><td>Retention cleanup, non-urgent</td></tr>
          <tr><td><code>backup.onedrive_partition</code></td><td>2</td><td>OneDrive file-shard fanout</td></tr>
          <tr><td><code>backup.chats_partition</code></td><td>12</td><td>Teams chat shard (≈9.5K shards on 5K users)</td></tr>
          <tr><td><code>backup.mail_partition</code></td><td>4</td><td>Mailbox folder shards (USER_MAIL + MAILBOX + SHARED_MAILBOX + ROOM_MAILBOX)</td></tr>
          <tr><td><code>backup.sharepoint_partition</code></td><td>2</td><td>SharePoint drive shards</td></tr>
          <tr><td><code>backup.groups_partition</code></td><td>4</td><td>Teams channel shards</td></tr>
          <tr><td><code>backup.entra_partition</code></td><td>4</td><td>Entra category shards (USERS/GROUPS/ROLES/SECURITY/AUDIT/APPLICATIONS/INTUNE/ADMIN_UNITS)</td></tr>
        </tbody>
      </table>

      <h4>Restore queue family</h4>
      <table>
        <thead><tr><th>Queue</th><th>Prefetch</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td><code>restore.urgent</code></td><td>10</td><td>Cross-user item restores</td></tr>
          <tr><td><code>restore.normal</code></td><td>30</td><td>Default; whale routing (&gt;5 GiB) → heavy pool</td></tr>
          <tr><td><code>restore.low</code></td><td>50</td><td>ZIP exports, direct downloads</td></tr>
        </tbody>
      </table>

      <h4>Discovery queue family</h4>
      <table>
        <thead><tr><th>Queue</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td><code>discovery.m365</code></td><td>Tenant-wide M365 resource enumeration</td></tr>
          <tr><td><code>discovery.azure</code></td><td>Azure subscription enumeration</td></tr>
          <tr><td><code>discovery.tier2</code></td><td>Per-user Tier-2 child resource materialization</td></tr>
        </tbody>
      </table>

      <h4>Azure queue family</h4>
      <table>
        <thead><tr><th>Queue</th><th>Prefetch</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td><code>azure.sql</code></td><td>3</td><td>Azure SQL backup (BACPAC export)</td></tr>
          <tr><td><code>azure.postgres</code></td><td>3</td><td>PostgreSQL backup (native API / <code>pg_dump</code>)</td></tr>
          <tr><td><code>azure.restore.sql</code></td><td>2</td><td>SQL restore (PITR or BACPAC import)</td></tr>
          <tr><td><code>azure.restore.postgres</code></td><td>2</td><td>Postgres restore (PITR or <code>pg_restore</code>)</td></tr>
        </tbody>
      </table>

      <h4>Message factories</h4>
      <p>Defined in <code>shared/message_bus.py</code>:</p>
      <ul>
        <li><code>create_backup_message</code> — single-resource backup</li>
        <li><code>create_mass_backup_message</code> — batch envelope</li>
        <li><code>create_onedrive_partition_message</code></li>
        <li><code>create_chats_partition_message</code></li>
        <li><code>create_mail_partition_message</code></li>
        <li><code>create_sharepoint_partition_message</code></li>
        <li><code>create_groups_partition_message</code></li>
        <li><code>create_entra_partition_message</code></li>
        <li><code>create_restore_message</code> — restore envelope with queue routing</li>
        <li><code>create_discovery_message</code></li>
        <li><code>create_notification_message</code> (reserved)</li>
        <li><code>create_audit_event_message</code></li>
      </ul>

      <h4>Full topology reference</h4>
      <p>
        Per-queue publishers/consumers with file:line citations,
        message shapes, prefetch tuning, factory function details,
        DLQ behavior:
      </p>
      <Reference file="messagebus.md" />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  STORAGE LAYER
// ─────────────────────────────────────────────────────────────────────────
export function StorageSection() {
  return (
    <>
      <p>
        Pluggable, content-addressable blob storage. The active backend is
        selected by <code>system_config.active_backend_id</code> and
        served via <code>shared/storage/router.py</code>. Every snapshot
        item carries a <code>backend_id</code> so a runtime swap can
        re-target new writes without invalidating old reads.
      </p>

      <h4>Backend implementations</h4>
      <ul>
        <li>
          <strong>Azure Blob</strong> (<code>shared/storage/azure_blob.py</code>
          {' '}+ <code>shared/azure_storage.py</code>). Multi-shard accounts,
          Server-Side Copy from Graph <code>@downloadUrl</code>,
          multi-part upload, blob versioning, lifecycle to cool/archive,
          BYOK via Key Vault, WORM (legal hold + time-based immutability).
        </li>
        <li>
          <strong>SeaweedFS</strong> (<code>shared/storage/seaweedfs.py</code>).
          S3-compatible via <code>aioboto3</code>, ObjectLock support for
          immutability parity with Azure WORM.
        </li>
      </ul>

      <h4>Content-addressable dedup</h4>
      <p>
        Every blob is content-hashed (BLAKE3) before upload. The blob path
        derives from <code>(content_hash, content_type)</code>, so two
        users uploading the same mail attachment write the same blob —
        the second upload short-circuits on a <code>HEAD</code> check.
        See <code>shared/blob_dedup.py</code> for the TTL-LRU cache that
        avoids the HEAD round-trip for hot keys.
      </p>

      <h4>Server-Side Copy (SSC)</h4>
      <p>
        OneDrive files larger than <code>SSC_THRESHOLD_BYTES</code>
        (default 10 MiB) use Graph <code>@downloadUrl</code> →{' '}
        <code>x-ms-copy-source</code> directly to Azure. Bytes never
        touch the worker process. Millisecond-scale "transfers" for
        files where the Microsoft CDN already has the bytes.
      </p>

      <h4>Container layout</h4>
      <p>
        Containers are named <code>backup-{`{resource-type}`}-{`{tenant-short-8}`}</code>.
        E.g. a mailbox snapshot for tenant <code>9adb037e-…</code>{' '}
        lands in <code>backup-user-mail-9adb037e</code>. SeaweedFS
        ignores the container arg (forced bucket); the same name is
        passed harmlessly.
      </p>

      <h4>Backend toggle (hot-swap)</h4>
      <p>
        Coordinated state machine in <code>storage_toggle_worker</code>.
        On a backend swap request:
      </p>
      <ol>
        <li><strong>DRAINING</strong> — new snapshots already route to the new backend; in-flight finish on the old one.</li>
        <li><strong>FLIPPING</strong> — <code>system_config.active_backend_id</code> updates; every process gets a LISTEN/NOTIFY ping.</li>
        <li><strong>SMOKE</strong> — a synthetic snapshot validates the new backend end-to-end.</li>
        <li><strong>COMMITTED</strong> — the toggle event is sealed; old backend stays read-only for archives.</li>
      </ol>

      <h4>SeaweedFS — sharded cluster (current deployment)</h4>
      <Callout kind="warn" title="DR / rebuild-critical">
        On-prem SeaweedFS runs as a <strong>sharded cluster</strong>: one
        <strong> volume-less coordinator</strong> (<code>weed master+filer+s3</code>)
        plus <strong>N volume-server services</strong> (<code>weed volume</code>),
        each with its own Railway volume. The coordinator stores{' '}
        <strong>zero blobs by itself</strong> — deploying it without the volume
        servers makes every backup write fail (<code>no writable volumes</code>).
        Full architecture, deploy/DR steps, env vars, and operational notes are
        in the reference below.
      </Callout>
      <Reference file="seaweedfs-sharding.md" />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  GRAPH INTEGRATION
// ─────────────────────────────────────────────────────────────────────────
export function GraphIntegrationSection() {
  return (
    <>
      <p>
        Microsoft Graph is the gating resource. Almost every M365 backup
        path is Graph-bound. TMvault leans on three techniques to scale:
        multi-app sharding, delta tokens, and content dedup.
      </p>

      <h4>Multi-app manager</h4>
      <p>
        <code>shared/multi_app_manager.py</code> distributes Graph
        requests across N Entra app registrations
        (<code>APP_1_*</code> through <code>APP_N_*</code> env vars).
        Each app has its own per-mailbox throttle bucket — using 12 apps
        gives 12× the per-mailbox ceiling. A circuit breaker tags an
        app as <em>throttled</em> on sustained 429s and rotates it out
        of the pool for a cool-down window.
      </p>

      <h4>Priority dispatch</h4>
      <p>
        <code>shared/graph_priority.py</code> maps queue → priority
        (URGENT / HIGH / NORMAL). A urgent backup gets first access to
        the token bucket; a low-priority retention sweep yields.
        Prevents user-triggered work from starving behind a 5K-user
        scheduled bulk run.
      </p>

      <h4>Delta tokens</h4>
      <p>
        Incremental backups skip Graph rate-limit budget by reading
        only the changes since the last successful snapshot. Stored
        per-resource in <code>snapshot.delta_token</code>; per-folder
        in <code>mail_folder_deltas</code>; per-chat in{' '}
        <code>snapshot.delta_tokens_json</code>'s{' '}
        <code>chat_delta_tokens</code> map.
      </p>

      <h4>Batch GET</h4>
      <p>
        <code>shared/graph_batch.py</code> bundles up to 20{' '}
        <code>GET</code> calls per HTTPS request via the Graph{' '}
        <code>$batch</code> endpoint. Cuts request count by ~20× for
        per-item enumeration paths (chat member lookups, mail folder
        fingerprints).
      </p>

      <h4>Retry policy</h4>
      <p>
        <code>shared/_graph_retry.py</code> classifies 429 / 5xx /
        connection-reset / stream-drop. <code>graph_ratelimit.py</code>
        applies exponential backoff + jitter capped at the Graph{' '}
        <code>Retry-After</code> header when present.
      </p>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  FRONTEND
// ─────────────────────────────────────────────────────────────────────────
export function FrontendSection() {
  return (
    <>
      <p>
        <code>tm_vault/</code> — React 19 + TypeScript SPA. Vite dev
        server on port 4200. Router: <code>react-router-dom@7</code>.
        Charting: <code>recharts</code>. No global state manager —
        per-component state with localStorage persistence for nav and
        theme.
      </p>

      <h4>Build & dev</h4>
      <table>
        <thead><tr><th>Script</th><th>Effect</th></tr></thead>
        <tbody>
          <tr><td><code>npm run dev</code></td><td>Vite dev server on http://localhost:4200</td></tr>
          <tr><td><code>npm run build</code></td><td><code>tsc -b</code> then <code>vite build</code> → <code>dist/</code></td></tr>
          <tr><td><code>npm run lint</code></td><td>ESLint over <code>src/</code></td></tr>
          <tr><td><code>npm run preview</code></td><td>Preview production build locally</td></tr>
          <tr><td><code>npm run e2e</code></td><td>Playwright tests in <code>e2e/</code></td></tr>
        </tbody>
      </table>

      <h4>Routes (App.tsx)</h4>
      <table>
        <thead><tr><th>Path</th><th>Page</th></tr></thead>
        <tbody>
          <tr><td><code>/</code></td><td>Auto-redirect: signed in → <code>/tenants</code>, else <code>/signin</code></td></tr>
          <tr><td><code>/signin</code> · <code>/signup</code></td><td>Microsoft OAuth entry</td></tr>
          <tr><td><code>/auth/callback</code></td><td>OAuth code exchange (URL fragment, purged immediately)</td></tr>
          <tr><td><code>/datasource-callback</code></td><td>M365 datasource OAuth</td></tr>
          <tr><td><code>/azure-datasource-callback</code></td><td>Azure datasource OAuth</td></tr>
          <tr><td><code>/power-bi-callback</code></td><td>Power BI datasource OAuth</td></tr>
          <tr><td><code>/tenants</code></td><td>Datasource picker / add</td></tr>
          <tr><td><code>/tenants/:tenantId/:serviceType/overview</code></td><td>Dashboard — protection %, 7-day chart, size summary</td></tr>
          <tr><td><code>/tenants/:tenantId/:serviceType/protection</code></td><td>Resource list, SLA assignment, trigger backup</td></tr>
          <tr><td><code>/tenants/:tenantId/:serviceType/protection/recovery</code></td><td>Item-level recovery browser</td></tr>
          <tr><td><code>/tenants/:tenantId/:serviceType/protection/settings</code></td><td>Per-tenant SLA / consent / secrets</td></tr>
          <tr><td><code>/tenants/:tenantId/:serviceType/global-search</code></td><td>Full-text search across workloads</td></tr>
          <tr><td><code>/activity</code></td><td>Tasks / Audit / Risk Signals tabs</td></tr>
          <tr><td><code>/settings/storage</code></td><td>Storage backend configuration</td></tr>
          <tr><td><code>/configuration</code></td><td>Reports, webhooks, notifications</td></tr>
          <tr><td><code>/docs</code></td><td>This documentation page</td></tr>
        </tbody>
      </table>

      <h4>API services (src/services/)</h4>
      <table>
        <thead><tr><th>File</th><th>Backend endpoints wrapped</th></tr></thead>
        <tbody>
          <tr><td><code>auth.ts</code></td><td><code>POST /auth/microsoft/url</code>, <code>POST /auth/callback</code>, <code>POST /auth/refresh</code>, <code>POST /auth/logout</code>, <code>GET /auth/me</code></td></tr>
          <tr><td><code>datasource.ts</code></td><td><code>GET /tenants</code> (in-memory cache, stale-404 refresh)</td></tr>
          <tr><td><code>activity.ts</code></td><td><code>GET /activity</code>, <code>POST /activity/{`{jobId}`}/cancel</code>, <code>GET /activity/csv</code></td></tr>
          <tr><td><code>audit.ts</code></td><td><code>GET /audit</code>, <code>GET /audit/{`{id}`}</code>, <code>GET /audit/risk-signals</code></td></tr>
          <tr><td><code>recovery.ts</code></td><td><code>GET /recovery</code>, <code>POST /recovery/search</code></td></tr>
          <tr><td><code>snapshot.ts</code></td><td><code>GET /snapshots</code>, <code>GET /snapshots/{`{id}`}/content</code>, <code>GET /snapshots/{`{id}`}/size</code></td></tr>
          <tr><td><code>restore.ts</code></td><td><code>POST /restore</code> (with format, destination, scope)</td></tr>
          <tr><td><code>resource.ts</code></td><td><code>GET /resources</code>, <code>POST /resources/{`{id}`}/policy/{`{policyId}`}</code>, <code>POST /resources/{`{id}`}/backup</code></td></tr>
          <tr><td><code>sla.ts</code></td><td>SLA policy CRUD</td></tr>
          <tr><td><code>search.ts</code></td><td><code>POST /search?q=…</code></td></tr>
          <tr><td><code>reports.ts</code></td><td>Report config + send</td></tr>
          <tr><td><code>tenant-info.ts</code></td><td><code>GET /tenants/{`{id}`}/info</code>, <code>GET /tenants/{`{id}`}/usage-report</code></td></tr>
          <tr><td><code>navState.ts</code></td><td>localStorage-only nav restoration (tenantId / serviceType / subRoute)</td></tr>
        </tbody>
      </table>

      <h4>Auth model</h4>
      <ul>
        <li>Access token: HttpOnly cookie (JS-unreadable). XSS-proof.</li>
        <li>localStorage <code>user</code>: non-credential breadcrumb for UX only.</li>
        <li>Single-flight token refresh on 401; proactive refresh 60s before expiry (reads <code>access_token_expires_at</code> cookie).</li>
        <li>Stale-tenant 404 emits <code>tm:tenant-stale</code> event → frontend routes back to <code>/tenants</code>.</li>
      </ul>

      <h4>Global fetch interceptor</h4>
      <p>
        <code>src/main.tsx</code> patches <code>window.fetch</code>:
        auto-includes <code>credentials: 'include'</code>, single-flight
        retries on 401, dispatches <code>tm:auth-refresh</code> events
        so other tabs can react.
      </p>

      <h4>Full frontend reference</h4>
      <Reference file="frontend.md" />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  ENV VARS (placeholder — full table appended by parallel agent)
// ─────────────────────────────────────────────────────────────────────────
export function EnvVarsSection() {
  return (
    <>
      <p>
        Authoritative source is <code>tm_backend/shared/config.py</code>{' '}
        (Pydantic <code>BaseSettings</code>) — every attribute is an env
        var with type-coerced default. Workers and individual services
        also read additional <code>os.getenv()</code> values inline.
      </p>

      <Callout kind="note" title="Full reference: 402 variables across 16 categories">
        The most-tuned variables are summarized in the tables below.
        For the exhaustive reference (sweep extracted{' '}
        <strong>350 unique env var names + 90 dynamic{' '}
        <code>APP_&lt;N&gt;_*</code> slots</strong>) see the embedded
        reference at the end of this section.
      </Callout>

      <h4>Database</h4>
      <table>
        <thead><tr><th>Env Var</th><th>Default</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>DB_HOST</code></td><td><em>(required)</em></td><td>Postgres host (use the orchestrator's internal DNS name)</td></tr>
          <tr><td><code>DB_PORT</code></td><td><code>5432</code></td><td>Postgres port</td></tr>
          <tr><td><code>DB_USERNAME</code></td><td><code>postgres</code></td><td>Postgres user</td></tr>
          <tr><td><code>DB_PASSWORD</code></td><td><em>(required)</em></td><td>Postgres password</td></tr>
          <tr><td><code>DB_NAME</code></td><td><em>(required)</em></td><td>Database name</td></tr>
          <tr><td><code>DB_SCHEMA</code></td><td><code>tm_vault</code></td><td>Postgres schema (search_path)</td></tr>
          <tr><td><code>DB_POOL_SIZE</code></td><td><code>20</code></td><td>SQLAlchemy pool size per service replica</td></tr>
          <tr><td><code>DB_MAX_OVERFLOW</code></td><td><code>10</code></td><td>Pool overflow allowance</td></tr>
          <tr><td><code>DB_POOL_TIMEOUT</code></td><td><code>30</code></td><td>Acquire timeout (s)</td></tr>
          <tr><td><code>DB_POOL_RECYCLE</code></td><td><code>1800</code></td><td>Recycle every N seconds</td></tr>
          <tr><td><code>DB_POOL_USE_LIFO</code></td><td><code>true</code></td><td>LIFO checkout (warmer connections)</td></tr>
        </tbody>
      </table>

      <h4>RabbitMQ</h4>
      <table>
        <thead><tr><th>Env Var</th><th>Default</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>RABBITMQ_URL</code></td><td><em>(optional override)</em></td><td>Full AMQP URL; takes precedence over individual fields</td></tr>
          <tr><td><code>RABBITMQ_HOST</code></td><td><code>localhost</code></td><td>Broker host</td></tr>
          <tr><td><code>RABBITMQ_PORT</code></td><td><code>5672</code></td><td>AMQP port</td></tr>
          <tr><td><code>RABBITMQ_USERNAME</code></td><td><code>guest</code></td><td>AMQP user</td></tr>
          <tr><td><code>RABBITMQ_PASSWORD</code></td><td><code>guest</code></td><td>AMQP password</td></tr>
          <tr><td><code>RABBITMQ_ENABLED</code></td><td><code>true</code></td><td>Master switch — set <code>false</code> to disable all messaging</td></tr>
          <tr><td><code>RABBITMQ_CONSUMER_HEARTBEAT_SECONDS</code></td><td><code>604800</code></td><td>7 days — prevents mid-backup redelivery</td></tr>
          <tr><td><code>RABBITMQ_CONSUMER_TIMEOUT_MS</code></td><td><code>604800000</code></td><td>7 days — broker-side redelivery timeout</td></tr>
        </tbody>
      </table>

      <h4>Microsoft Graph (multi-app)</h4>
      <table>
        <thead><tr><th>Env Var</th><th>Default</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>APP_1_CLIENT_ID</code></td><td><em>(required)</em></td><td>First Entra app registration client_id</td></tr>
          <tr><td><code>APP_1_CLIENT_SECRET</code></td><td><em>(required)</em></td><td>First Entra app client_secret</td></tr>
          <tr><td><code>APP_2_CLIENT_ID</code>…<code>APP_N_CLIENT_ID</code></td><td><em>(optional)</em></td><td>Additional apps for multi-app rotation. Production fleet uses 12-20 apps.</td></tr>
          <tr><td><code>AZURE_TENANT_ID</code></td><td><em>(required)</em></td><td>Customer's Entra tenant id (single-tenant apps)</td></tr>
        </tbody>
      </table>

      <h4>Worker tuning (selected)</h4>
      <table>
        <thead><tr><th>Env Var</th><th>Default</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>MAX_CONCURRENT_ONEDRIVE_BACKUPS_PER_WORKER</code></td><td>varies</td><td>Per-worker OneDrive concurrency ceiling</td></tr>
          <tr><td><code>USER_CHATS_PARALLEL_CHATS</code></td><td><code>32</code></td><td>Per-user chat fanout cap</td></tr>
          <tr><td><code>USER_CHATS_APP_SHARDS</code></td><td><code>0</code></td><td>0 = use all healthy apps; otherwise cap</td></tr>
          <tr><td><code>USER_CHATS_TIMEOUT_S</code></td><td><code>43200</code></td><td>12 hours — per-user chat drain timeout</td></tr>
          <tr><td><code>CHAT_THREAD_DRAIN_FRESHNESS_S</code></td><td><code>25200</code></td><td>7 hours — cross-user dedup window</td></tr>
          <tr><td><code>USER_CHATS_FULL_RESCAN_DAYS</code></td><td><code>3</code></td><td>Force a full rescan every N days</td></tr>
          <tr><td><code>ONEDRIVE_PREFETCH_CONCURRENCY</code></td><td><code>16</code></td><td>OneDrive prefetcher fanout</td></tr>
          <tr><td><code>BACKUP_FANOUT_ENABLED</code></td><td><code>true</code></td><td>Master fanout switch</td></tr>
          <tr><td><code>ONEDRIVE_PARTITION_ENABLED</code></td><td><code>true</code></td><td>Enable OneDrive partition fanout</td></tr>
          <tr><td><code>CHATS_PARTITION_ENABLED</code></td><td><code>true</code></td><td>Enable Teams chats partition fanout</td></tr>
          <tr><td><code>MAIL_PARTITION_ENABLED</code></td><td><code>true</code></td><td>Enable mailbox partition fanout</td></tr>
          <tr><td><code>SP_PARTITION_ENABLED</code></td><td><code>true</code></td><td>Enable SharePoint partition fanout</td></tr>
          <tr><td><code>GROUPS_PARTITION_ENABLED</code></td><td><code>true</code></td><td>Enable Teams channels partition fanout</td></tr>
          <tr><td><code>ENTRA_PARTITION_ENABLED</code></td><td><code>true</code></td><td>Enable Entra category partition fanout</td></tr>
          <tr><td><code>BATCH_ROW_REDESIGN_ENABLED</code></td><td><code>true</code></td><td>Gate for the 2026-05 batch-rollup hooks (must be <code>true</code> in prod)</td></tr>
          <tr><td><code>USER_CHATS_HC_BARRIER_DETACHED</code></td><td><code>true</code></td><td>Detached HC drain barrier (Item C optimization)</td></tr>
        </tbody>
      </table>

      <h4>Frontend (Vite)</h4>
      <table>
        <thead><tr><th>Env Var</th><th>Default</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>VITE_API_URL</code></td><td><code>http://localhost:8080/api/v1</code></td><td>Backend base URL — point at the production API gateway hostname.</td></tr>
        </tbody>
      </table>

      <h4>Full reference (402 variables across 16 categories)</h4>
      <Reference file="envvars.md" />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  DEPLOYMENT
// ─────────────────────────────────────────────────────────────────────────
export function DeploymentSection() {
  return (
    <>
      <p>
        TMvault is hosting-agnostic. Each process is a standalone
        Python or Node application that listens on a port (HTTP
        services) or runs as a long-lived event loop (workers and
        schedulers). It can be deployed to any orchestrator that can
        run container images and route traffic — Kubernetes, AWS ECS,
        Azure Container Apps, Nomad, or a managed PaaS.
      </p>

      <h4>Deployable units</h4>
      <p>
        Group the components below into deployments. Each row is one
        process. Workers should be horizontally scalable; HTTP services
        should sit behind a load balancer.
      </p>
      <table>
        <thead>
          <tr>
            <th>Process</th>
            <th>Kind</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>api_gateway</code></td><td>HTTP ingress</td><td><code>services/api-gateway/</code></td></tr>
          <tr><td><code>auth_service</code></td><td>HTTP</td><td><code>services/auth-service/</code></td></tr>
          <tr><td><code>tenant_service</code></td><td>HTTP</td><td><code>services/tenant-service/</code></td></tr>
          <tr><td><code>resource_service</code></td><td>HTTP</td><td><code>services/resource-service/</code></td></tr>
          <tr><td><code>job_service</code></td><td>HTTP</td><td><code>services/job-service/</code></td></tr>
          <tr><td><code>snapshot_service</code></td><td>HTTP</td><td><code>services/snapshot-service/</code></td></tr>
          <tr><td><code>audit_service</code></td><td>HTTP + RMQ consumer</td><td><code>services/audit-service/</code></td></tr>
          <tr><td><code>dashboard_service</code></td><td>HTTP</td><td><code>services/dashboard-service/</code></td></tr>
          <tr><td><code>report_service</code></td><td>HTTP</td><td><code>services/report-service/</code></td></tr>
          <tr><td><code>search_service</code></td><td>HTTP</td><td><code>services/search-service/</code></td></tr>
          <tr><td><code>alert_service</code></td><td>HTTP</td><td><code>services/alert-service/</code></td></tr>
          <tr><td><code>graph_proxy</code></td><td>HTTP</td><td><code>services/graph-proxy/</code></td></tr>
          <tr><td><code>delta_token</code></td><td>HTTP</td><td><code>services/delta-token/</code></td></tr>
          <tr><td><code>progress_tracker</code></td><td>HTTP</td><td><code>services/progress-tracker/</code></td></tr>
          <tr><td><code>backup_scheduler</code></td><td>Scheduler (APScheduler)</td><td><code>services/backup-scheduler/</code></td></tr>
          <tr><td><code>backup_worker</code> (light)</td><td>RMQ worker</td><td><code>workers/backup-worker/</code></td></tr>
          <tr><td><code>backup_worker_heavy</code></td><td>RMQ worker (heavy lane)</td><td><code>workers/backup-worker/</code> with <code>BACKUP_WORKER_DEDICATED_ONLY=true</code></td></tr>
          <tr><td><code>restore_worker</code></td><td>RMQ worker</td><td><code>workers/restore-worker/</code></td></tr>
          <tr><td><code>discovery_worker</code></td><td>RMQ worker</td><td><code>workers/discovery-worker/</code></td></tr>
          <tr><td><code>chat_exporter</code></td><td>RMQ worker</td><td><code>workers/chat-export-worker/</code></td></tr>
          <tr><td><code>azure_workload</code></td><td>RMQ worker</td><td><code>workers/azure-workload-worker/</code></td></tr>
          <tr><td><code>dr_replication</code></td><td>Worker</td><td><code>services/dr-replication-worker/</code></td></tr>
          <tr><td><code>storage_toggle_worker</code></td><td>Worker</td><td><code>services/storage_toggle_worker/</code></td></tr>
          <tr><td><code>autoscaler</code></td><td>Worker</td><td><code>services/autoscaler/</code></td></tr>
        </tbody>
      </table>

      <h4>Infrastructure dependencies</h4>
      <ul>
        <li>
          <strong>Postgres 16</strong> — primary OLTP store. One
          database, one schema (<code>tm_vault</code>). Sized for the
          backup workload (high write rate from{' '}
          <code>snapshot_items</code>, modest read rate). Run with{' '}
          PgBouncer in front for connection pooling if the worker
          fleet exceeds ~100 connections.
        </li>
        <li>
          <strong>RabbitMQ 3.13+</strong> — single durable DIRECT
          exchange. Cluster recommended for HA. Quorum queues are
          fine; classic mirrored queues are not required.
        </li>
        <li>
          <strong>Blob storage</strong> — at least one of: Azure Blob
          Storage account (preferred for Microsoft 365 integration —
          enables Server-Side Copy from Graph download URLs), or
          SeaweedFS / any S3-compatible store for self-hosting.
        </li>
        <li>
          <strong>Egress to Microsoft Graph + Azure ARM</strong> from
          the worker subnets. Graph 429 throttling is per-tenant
          per-app, so plan multiple Entra app registrations
          (<code>APP_1_*</code>…<code>APP_N_*</code>) for scale.
        </li>
      </ul>

      <h4>Sequencing constraints</h4>
      <ol>
        <li>
          Postgres + RabbitMQ + at least one blob store must be live
          before any service starts.
        </li>
        <li>
          Run <code>alembic upgrade head</code> against the DB before
          starting any service.
        </li>
        <li>
          Bootstrap the active storage backend by inserting a row in{' '}
          <code>storage_backends</code> and setting{' '}
          <code>system_config.active_backend_id</code> — the helper
          in <code>shared/storage_bootstrap.py</code> does this
          idempotently on first boot of any service.
        </li>
        <li>
          Start services in any order. They are stateless and will
          reconnect to RabbitMQ / Postgres with backoff if either is
          temporarily unreachable.
        </li>
      </ol>

      <h4>Configuration</h4>
      <p>
        All config flows through environment variables — see the{' '}
        <a href="#env-vars">Environment Variables</a> section for the
        complete reference. Inject them via the orchestrator's secrets
        / env-var mechanism. The <code>INTERNAL_API_KEY</code> must
        be identical across every service or internal calls fail
        closed with 503.
      </p>

      <h4>Scaling</h4>
      <ul>
        <li>
          <strong>HTTP services</strong> — stateless, scale by
          replica count. Front with a load balancer.
        </li>
        <li>
          <strong>Workers</strong> — bound by RabbitMQ prefetch and
          per-process semaphores. Scale by replica count; queue
          depth is the primary signal. The bundled
          <code>autoscaler</code> reads queue depth and emits a
          scale signal — wire it to your orchestrator's scaling API
          (or skip it and use the orchestrator's native autoscaling
          on queue depth / CPU).
        </li>
        <li>
          <strong>Scheduler</strong> — run exactly one replica of{' '}
          <code>backup_scheduler</code>. APScheduler holds in-memory
          locks; multiple replicas would double-fire SLA ticks.
        </li>
      </ul>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  OBSERVABILITY
// ─────────────────────────────────────────────────────────────────────────
export function ObservabilitySection() {
  return (
    <>
      <p>
        Three observability surfaces: Prometheus metrics, an in-database
        audit log, and structured stdout logs (capture via the
        orchestrator's log pipeline).
      </p>

      <h4>Prometheus metrics</h4>
      <ul>
        <li>
          <code>shared/core_metrics.py</code> — backup latency,
          throughput, cost per workload, queue depth gauges.
        </li>
        <li>
          <code>shared/pst_metrics.py</code> — PST export progress,
          rate, retries. Lazy-init, port <code>9100</code>.
        </li>
        <li>
          <code>shared/sla_metrics.py</code> — SLA reconcile / sweep
          counters. Lazy-init, port <code>9101</code>.
        </li>
        <li>
          <code>shared/memory_monitor.py</code> — RSS watcher that
          triggers soft shutdown when a worker breaches a configured
          high-water mark.
        </li>
      </ul>

      <h4>Audit log</h4>
      <p>
        Every backup / restore / export / discovery / cancellation
        emits a row into the <code>audit_events</code> table via
        <code>shared/audit.py</code> (fire-and-forget HTTP POST to
        <code>audit_service</code>). Indexed on{' '}
        <code>(org_id, tenant_id, action, created_at)</code>. The
        frontend's <em>Activity → Audit</em> tab reads from this
        table.
      </p>

      <h4>Log conventions</h4>
      <p>
        Workers prefix every log line with the worker id and the
        domain tag:
      </p>
      <pre><code>{`[LIGHT] [worker-4e051ccb] [USER_CHATS START] Chats — Hemant Singh (…)
[LIGHT] [worker-4e051ccb] [USER_CHATS] [PERF] scope fingerprint warmup: 12 shards in 1.99s
[LIGHT] [worker-4e051ccb] [HC_FINALIZER] snap=… settled status=COMPLETE elapsed=1.2s`}</code></pre>
      <p>
        The <code>[LIGHT]</code> / <code>[HEAVY]</code> prefix flags
        the worker pool. Grep-friendly tags
        (<code>[HC_FINALIZER]</code>, <code>[PERF]</code>,{' '}
        <code>[USER_CHATS START]</code>, <code>[CANCEL]</code>,{' '}
        <code>[REAPER]</code>) make log-aggregator filtering effective.
      </p>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  TROUBLESHOOTING
// ─────────────────────────────────────────────────────────────────────────
export function TroubleshootingSection() {
  return (
    <>
      <h4>Postgres <code>TooManyConnectionsError</code></h4>
      <p>
        Raise <code>POSTGRES_MAX_CONNECTIONS</code> (or the equivalent
        <code>ALTER SYSTEM SET max_connections = …</code>) or front the
        cluster with PgBouncer. <strong>Do not shrink</strong>{' '}
        <code>DB_POOL_SIZE</code> / <code>DB_MAX_OVERFLOW</code> on the
        clients — that just trades one symptom for another.
      </p>

      <h4>Activity row stuck at "In Progress" after cancel</h4>
      <p>
        Cancel UPDATEs only flip <code>status='IN_PROGRESS'</code>{' '}
        snapshots. If the snapshot stamped COMPLETED in the race window
        before the cancel UPDATE ran, the parent batch's rollup would
        see a mix and remain IN_PROGRESS.
      </p>
      <p>
        Defenses now in place:
      </p>
      <ul>
        <li>
          Worker-side finalize guard
          (<code>_coerce_snapshot_terminal_on_cancel</code>) stamps
          FAILED instead of COMPLETED when the parent job is already
          CANCELLED.
        </li>
        <li>
          Cancel handler writes <code>extra_data.cancelled_at</code>{' '}
          on COMPLETED + PARTIAL snapshots so the sweep at{' '}
          <code>backup-scheduler:1019</code> reaps them.
        </li>
        <li>
          Cancel cascade force-flips{' '}
          <code>backup_batches.status</code> → CANCELLED even when the
          strict finalizer declines (sibling jobs still RUNNING).
        </li>
      </ul>

      <h4>Duplicate backup triggers (43-second-apart batches)</h4>
      <p>
        Two manual_bulk batches firing within ~1 min cause duplicate
        per-resource dispatch. The job-service now debounces 30s on
        manual_bulk batches per tenant in
        <code>_create_batch_backup_jobs</code>. A duplicate trigger
        returns a pointer to the existing in-flight batch instead of
        creating a parallel run.
      </p>

      <h4>Ghost prior snapshots (bytes_added pollution)</h4>
      <p>
        Symptom: an incremental backup with no new data reports a full
        inventory's worth of <code>bytes_added</code>. Cause: a
        zero-item COMPLETED snapshot was the most recent prior; the
        delta calc anchored against it. Fix:{' '}
        <code>_compute_snapshot_delta_from_prior</code> now filters
        ghost priors via
        <code>or_(Snapshot.item_count &gt; 0, Snapshot.bytes_total &gt; 0)</code>.
        Ghost snapshots themselves are prevented upstream by the
        manual_bulk debounce + cancellation full-revert.
      </p>

      <h4>Cancel <code>500 Internal Server Error</code> with PostgresSyntaxError</h4>
      <p>
        SQLAlchemy + asyncpg confuses <code>:jid::text</code>{' '}
        parameter casts (mistakes <code>::</code> for a separator).
        Use <code>cast(:jid AS text)</code> instead. Already applied
        in cancel paths and snapshot UPDATE statements.
      </p>

      <h4>Concurrent cancel deadlock</h4>
      <p>
        The UI fires <code>Promise.all</code> across sibling job
        cancels in a batch, producing 3-way deadlocks on shared rows.
        Fix: <code>pg_advisory_xact_lock(hashtext(batch_id))</code> at
        the top of <code>cancel_job</code> serializes cancels per batch.
        Locks auto-release on commit/rollback (transaction-scoped).
      </p>

      <h4>Workers showing duplicate <code>USER_CHATS START</code></h4>
      <p>
        Different worker IDs all logging <code>USER_CHATS START</code>{' '}
        for the same user means duplicate jobs are in flight — either
        a duplicate trigger leaked past the debounce window, or RMQ
        redelivered the message after a consumer ack failure.
        Confirm by querying <code>jobs</code> for that resource:
      </p>
      <pre><code>{`SELECT id, status, created_at, spec->>'batch_id' AS batch_id
  FROM jobs
 WHERE resource_id = '<rid>'
   AND created_at > NOW() - INTERVAL '15 minutes';`}</code></pre>
    </>
  );
}
