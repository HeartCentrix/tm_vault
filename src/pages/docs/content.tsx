import type { ReactNode } from 'react';
import {
  OverviewSection,
  ArchitectureSection,
  GettingStartedSection,
  GraphAppSetupSection,
  ExchangeArchiveSection,
  ServicesSection,
  WorkersSection,
  DataModelSection,
  SharedModulesSection,
  MessageBusSection,
  StorageSection,
  GraphIntegrationSection,
  FrontendSection,
  EnvVarsSection,
  DeploymentSection,
  ObservabilitySection,
  TroubleshootingSection,
} from './sections';

export type DocSection = {
  id: string;
  title: string;
  level: 1 | 2 | 3 | 4;
  content?: ReactNode;
  children?: DocSection[];
};

// Top-level docs tree. Sidebar flattens this for navigation; content area renders
// every section recursively with its own anchor id.
export const DOCS_SECTIONS: DocSection[] = [
  {
    id: 'overview',
    title: 'Overview',
    level: 1,
    content: <OverviewSection />,
  },
  {
    id: 'architecture',
    title: 'Architecture',
    level: 1,
    content: <ArchitectureSection />,
  },
  {
    id: 'getting-started',
    title: 'Getting Started',
    level: 1,
    content: <GettingStartedSection />,
  },
  {
    id: 'graph-app-setup',
    title: 'Entra App Registration',
    level: 1,
    content: <GraphAppSetupSection />,
  },
  {
    id: 'exchange-archive',
    title: 'Exchange Online Archive',
    level: 1,
    content: <ExchangeArchiveSection />,
  },
  {
    id: 'services',
    title: 'Backend Services',
    level: 1,
    content: <ServicesSection />,
  },
  {
    id: 'workers',
    title: 'Backend Workers',
    level: 1,
    content: <WorkersSection />,
  },
  {
    id: 'data-model',
    title: 'Data Model',
    level: 1,
    content: <DataModelSection />,
  },
  {
    id: 'shared-modules',
    title: 'Shared Modules',
    level: 1,
    content: <SharedModulesSection />,
  },
  {
    id: 'message-bus',
    title: 'Message Bus & Queues',
    level: 1,
    content: <MessageBusSection />,
  },
  {
    id: 'storage',
    title: 'Storage Layer',
    level: 1,
    content: <StorageSection />,
  },
  {
    id: 'graph',
    title: 'Microsoft Graph Integration',
    level: 1,
    content: <GraphIntegrationSection />,
  },
  {
    id: 'frontend',
    title: 'Frontend (tm_vault)',
    level: 1,
    content: <FrontendSection />,
  },
  {
    id: 'env-vars',
    title: 'Environment Variables',
    level: 1,
    content: <EnvVarsSection />,
  },
  {
    id: 'deployment',
    title: 'Deployment',
    level: 1,
    content: <DeploymentSection />,
  },
  {
    id: 'observability',
    title: 'Observability & Metrics',
    level: 1,
    content: <ObservabilitySection />,
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    level: 1,
    content: <TroubleshootingSection />,
  },
];
