import { useEffect, useState } from 'react';
import {
  type ResourceGroup,
  type ResourceGroupRule,
  type SlaPolicy,
  listResourceGroups,
  createResourceGroup,
  updateResourceGroup,
  deleteResourceGroup,
  attachPolicyToGroup,
  detachPolicyFromGroup,
} from '../services/sla';
import './ResourceGroupManager.css';

interface Props {
  tenantId: string;
  policies: SlaPolicy[];
}

const FIELDS: Array<ResourceGroupRule['field']> = [
  'NAME', 'EMAIL', 'DEPARTMENT', 'CITY', 'COUNTRY', 'JOB_TITLE',
  'RESOURCE_TYPE', 'EXTERNAL_ID', 'TAG_VALUE',
];
const OPERATORS: Array<ResourceGroupRule['operator']> = [
  'EQUALS', 'NOT_EQUALS', 'CONTAINS', 'NOT_CONTAINS',
  'STARTS_WITH', 'ENDS_WITH', 'IN',
];

export default function ResourceGroupManager({ tenantId, policies }: Props) {
  const [groups, setGroups] = useState<ResourceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ResourceGroup | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const data = await listResourceGroups(tenantId);
      setGroups(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, [tenantId]);

  async function handleDelete(g: ResourceGroup) {
    if (!confirm(`Delete group "${g.name}"? Resources stay; only the rule and its policy attachments are removed.`)) return;
    try {
      await deleteResourceGroup(g.id);
      setGroups(prev => prev.filter(x => x.id !== g.id));
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="rgm-root">
      <div className="rgm-header">
        <div>
          <h3>Resource Groups</h3>
          <p>Group resources by attribute rules; attached SLA policies auto-protect new matches.</p>
        </div>
        <button className="rgm-btn primary" onClick={() => setShowCreate(true)}>+ New group</button>
      </div>

      {error && <div className="rgm-error">{error}</div>}

      {loading ? (
        <div className="rgm-empty">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="rgm-empty">No resource groups yet. Create one to auto-protect matching resources.</div>
      ) : (
        <table className="rgm-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Rules</th>
              <th>Combinator</th>
              <th>Priority</th>
              <th>Auto-protect</th>
              <th>Policies</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <tr key={g.id}>
                <td><strong>{g.name}</strong>{g.description && <div className="rgm-desc">{g.description}</div>}</td>
                <td>{g.groupType}</td>
                <td>{g.rules?.length || 0}</td>
                <td>{g.combinator}</td>
                <td>{g.priority}</td>
                <td>{g.autoProtectNew ? 'Yes' : 'No'}</td>
                <td>{g.attachedPolicyIds?.length || 0}</td>
                <td className="rgm-actions">
                  <button className="rgm-link" onClick={() => setEditing(g)}>Edit</button>
                  <button className="rgm-link danger" onClick={() => handleDelete(g)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(showCreate || editing) && (
        <GroupEditor
          tenantId={tenantId}
          policies={policies}
          existing={editing}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onSaved={() => { setShowCreate(false); setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

interface EditorProps {
  tenantId: string;
  policies: SlaPolicy[];
  existing: ResourceGroup | null;
  onClose: () => void;
  onSaved: () => void;
}

function GroupEditor({ tenantId, policies, existing, onClose, onSaved }: EditorProps) {
  const [g, setG] = useState<Partial<ResourceGroup>>(() => existing ? { ...existing } : {
    tenantId,
    name: '',
    description: '',
    groupType: 'DYNAMIC',
    combinator: 'AND',
    rules: [{ field: 'NAME', operator: 'CONTAINS', value: '' }],
    priority: 100,
    enabled: true,
    autoProtectNew: false,
    attachedPolicyIds: [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(p: Partial<ResourceGroup>) { setG(prev => ({ ...prev, ...p })); }

  function updateRule(idx: number, r: Partial<ResourceGroupRule>) {
    const next = [...(g.rules || [])];
    next[idx] = { ...next[idx], ...r };
    patch({ rules: next });
  }
  function addRule() {
    patch({ rules: [...(g.rules || []), { field: 'NAME', operator: 'CONTAINS', value: '' }] });
  }
  function removeRule(idx: number) {
    patch({ rules: (g.rules || []).filter((_, i) => i !== idx) });
  }

  async function handleSave() {
    if (!g.name?.trim()) { setError('Name is required'); return; }
    setSaving(true); setError(null);
    try {
      let saved: ResourceGroup;
      if (existing) {
        saved = await updateResourceGroup(existing.id, g);
      } else {
        saved = await createResourceGroup(g);
      }

      // Sync attached policies — diff the multiselect against the saved set
      const want = new Set(g.attachedPolicyIds || []);
      const have = new Set(saved.attachedPolicyIds || []);
      const toAttach = [...want].filter(id => !have.has(id));
      const toDetach = [...have].filter(id => !want.has(id));
      await Promise.all(toAttach.map(pid => attachPolicyToGroup(saved.id, pid)));
      await Promise.all(toDetach.map(pid => detachPolicyFromGroup(saved.id, pid)));

      onSaved();
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  function togglePolicy(pid: string) {
    const cur = new Set(g.attachedPolicyIds || []);
    if (cur.has(pid)) cur.delete(pid); else cur.add(pid);
    patch({ attachedPolicyIds: Array.from(cur) });
  }

  return (
    <div className="rgm-overlay" onClick={onClose}>
      <div className="rgm-modal" onClick={e => e.stopPropagation()}>
        <div className="rgm-modal-header">
          <h2>{existing ? `Edit group — ${existing.name}` : 'New resource group'}</h2>
          <button className="rgm-close" onClick={onClose}>×</button>
        </div>

        <div className="rgm-modal-body">
          <label className="rgm-row">
            <span>Name</span>
            <input type="text" value={g.name || ''} onChange={e => patch({ name: e.target.value })} placeholder="e.g. Engineering, Executives, EU users" />
          </label>
          <label className="rgm-row">
            <span>Description</span>
            <input type="text" value={g.description || ''} onChange={e => patch({ description: e.target.value })} />
          </label>

          <div className="rgm-grid-3">
            <label className="rgm-row">
              <span>Type</span>
              <select value={g.groupType || 'DYNAMIC'} onChange={e => patch({ groupType: e.target.value as any })}>
                <option value="DYNAMIC">Dynamic (rule-based)</option>
                <option value="STATIC">Static (explicit list)</option>
              </select>
            </label>
            <label className="rgm-row">
              <span>Match if</span>
              <select value={g.combinator || 'AND'} onChange={e => patch({ combinator: e.target.value as any })}>
                <option value="AND">All rules match</option>
                <option value="OR">Any rule matches</option>
              </select>
            </label>
            <label className="rgm-row">
              <span>Priority</span>
              <input type="number" value={g.priority ?? 100} onChange={e => patch({ priority: +e.target.value })} />
            </label>
          </div>

          {g.groupType === 'DYNAMIC' && (
            <div className="rgm-rules">
              <div className="rgm-rules-header">
                <span>Rules</span>
                <button className="rgm-link" onClick={addRule}>+ Add rule</button>
              </div>
              {(g.rules || []).map((rule, i) => (
                <div key={i} className="rgm-rule">
                  <select value={rule.field} onChange={e => updateRule(i, { field: e.target.value as any })}>
                    {FIELDS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <select value={rule.operator} onChange={e => updateRule(i, { operator: e.target.value as any })}>
                    {OPERATORS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <input type="text" value={rule.value} onChange={e => updateRule(i, { value: e.target.value })} placeholder={rule.operator === 'IN' ? 'a,b,c' : 'value'} />
                  <button className="rgm-link danger" onClick={() => removeRule(i)}>Remove</button>
                </div>
              ))}
              {(g.rules || []).length === 0 && <div className="rgm-empty">No rules — group will match nothing.</div>}
            </div>
          )}

          <div className="rgm-attached">
            <div className="rgm-rules-header">
              <span>Attached SLA policies</span>
              <span className="rgm-hint">When a resource matches this group, the first attached policy (by priority) auto-protects it.</span>
            </div>
            {policies.length === 0 ? (
              <div className="rgm-empty">No policies in this tenant yet.</div>
            ) : (
              <ul className="rgm-policy-list">
                {policies.map(p => (
                  <li key={p.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={(g.attachedPolicyIds || []).includes(p.id)}
                        onChange={() => togglePolicy(p.id)}
                      />
                      <strong>{p.name}</strong>
                      <span className="rgm-policy-meta">{p.frequency} · {p.retentionMode || 'FLAT'}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className="rgm-row inline">
            <input type="checkbox" checked={!!g.autoProtectNew} onChange={e => patch({ autoProtectNew: e.target.checked })} />
            <span>Auto-protect newly-discovered matching resources (discovery-worker hook)</span>
          </label>
          <label className="rgm-row inline">
            <input type="checkbox" checked={g.enabled !== false} onChange={e => patch({ enabled: e.target.checked })} />
            <span>Enabled</span>
          </label>
        </div>

        {error && <div className="rgm-error">{error}</div>}

        <div className="rgm-modal-footer">
          <button className="rgm-btn ghost" onClick={onClose}>Cancel</button>
          <button className="rgm-btn primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : (existing ? 'Save changes' : 'Create group')}
          </button>
        </div>
      </div>
    </div>
  );
}
