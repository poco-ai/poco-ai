import { SITE } from '../config'

export function prefixPublicPath(pathname: string): string {
  const base = SITE.base === '/' ? '' : SITE.base.replace(/\/+$/, '')
  return `${base}${pathname}`.replace(/\/{2,}/g, '/')
}
