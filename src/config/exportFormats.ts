// Export format options per resource type for the Download modal.
// Edit this map to change which formats appear for each tab.

import type { ContentTab } from '../services/snapshot';

export interface ExportFormatOption {
  value: string;
  label: string;
  hint?: string;
}

export const EXPORT_FORMATS: Record<ContentTab, ExportFormatOption[]> = {
  mail: [
    { value: 'PST', label: 'Export as PST' },
    { value: 'MBOX', label: 'Export as MBOX' },
    { value: 'EML', label: 'Export as EML' },
  ],
  onedrive: [
    { value: 'ZIP', label: 'Export as ZIP' },
    { value: 'ORIGINAL', label: 'Original files' },
  ],
  contacts: [
    { value: 'VCF', label: 'Export as VCF' },
    { value: 'CSV', label: 'Export as CSV' },
  ],
  calendar: [
    { value: 'ICS', label: 'Export as ICS' },
    { value: 'CSV', label: 'Export as CSV' },
  ],
  chats: [
    { value: 'HTML', label: 'Export as HTML' },
    { value: 'JSON', label: 'Export as JSON' },
    { value: 'PDF', label: 'Export as PDF' },
  ],
};

export const DEFAULT_FORMAT: Record<ContentTab, string> = {
  mail: 'EML',
  onedrive: 'ZIP',
  contacts: 'VCF',
  calendar: 'ICS',
  chats: 'HTML',
};

// Workload checkboxes shown when "Download all" is selected. Matches afi.ai layout.
export const DOWNLOAD_ALL_WORKLOADS = ['Mail', 'Contacts', 'Calendar', 'Chats', 'OneDrive'] as const;
export type DownloadWorkload = typeof DOWNLOAD_ALL_WORKLOADS[number];
