export interface TokenMaxExperimental {
  enabled?: boolean
}

export function isEnabled(cfg: { experimental?: { tokenmax?: TokenMaxExperimental } } | undefined | null): boolean {
  return cfg?.experimental?.tokenmax?.enabled === true
}
