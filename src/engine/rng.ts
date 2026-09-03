// 真随机：走 crypto.getRandomValues，不用 Math.random。
// 抽牌用的是「无偏拒绝采样」，不会因为取模让前几张牌概率偏高。
export interface Rng {
  pick<T>(items: readonly T[]): T
}

function randomUint32(): number {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0]
}

export const cryptoRng: Rng = {
  pick(items) {
    if (items.length === 0) throw new Error('empty pool')
    const n = items.length
    const limit = Math.floor(0x1_0000_0000 / n) * n
    let x = randomUint32()
    while (x >= limit) x = randomUint32()
    return items[x % n]
  },
}
