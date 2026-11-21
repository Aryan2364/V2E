/**
 * Test helper: presents several collaborating services as one object, so a spec that
 * exercises a feature across them (as the controller does) can call `facade.method()`
 * without caring which service owns it. Reads and writes (including `jest.spyOn`) are
 * forwarded to the owning service, and methods run with that service as `this`.
 */
export function composeServices<T = any>(...services: object[]): T {
  const ownerOf = (prop: string | symbol) => services.find((s) => prop in s)
  return new Proxy({} as object, {
    get(_t, prop) {
      const owner = ownerOf(prop) as Record<string | symbol, unknown> | undefined
      if (!owner) return undefined
      const v = owner[prop]
      return typeof v === 'function' && !(v as { _isMockFunction?: boolean })._isMockFunction
        ? (v as (...a: unknown[]) => unknown).bind(owner)
        : v
    },
    set(_t, prop, value) {
      const owner = (ownerOf(prop) ?? services[0]) as Record<string | symbol, unknown>
      owner[prop] = value
      return true
    },
    has: (_t, prop) => !!ownerOf(prop),
  }) as T
}
