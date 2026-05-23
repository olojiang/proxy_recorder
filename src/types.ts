export interface ProxyRule {
  id: string;
  host: string;
  target: string;
  mountPath?: string;
  virtualHost?: string;
  enabled: boolean;
  hostsEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RuleInput {
  host: string;
  target: string;
  mountPath?: string;
  virtualHost?: string;
  enabled?: boolean;
  hostsEnabled?: boolean;
}
