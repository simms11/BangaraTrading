import { GraphQLError, type ValidationRule } from 'graphql'

/**
 * B60: Depth limit for GraphQL queries.
 *
 * Without this, a public client can submit pathologically nested queries
 * (`{ users { orders { lineItems { product { vendor { user { ... } } } } } } }`)
 * that fan out into massive SQL joins / N+1 explosions and DoS the API.
 *
 * `maxDepth` counts nested field selections. The default — 8 — comfortably
 * accommodates our deepest legit query (orders → lineItems → product →
 * vendor → media) with room to spare, while shutting the door on
 * adversarial recursion.
 */
export function createDepthLimit(maxDepth = 8): ValidationRule {
  return function depthLimit(context) {
    return {
      Field(_node, _key, _parent, _path, ancestors) {
        let depth = 0
        for (const ancestor of ancestors) {
          if (!ancestor || Array.isArray(ancestor)) continue
          if ((ancestor as { kind?: string }).kind === 'Field') depth += 1
        }
        if (depth >= maxDepth) {
          context.reportError(
            new GraphQLError(`Query exceeds maximum depth of ${maxDepth}.`),
          )
        }
      },
    }
  }
}

/**
 * M19: Cap the `limit` argument on collection list queries.
 *
 * Without this, an anonymous client can request
 * `{ Products(limit: 10000) { ... } }` and pull 10k rows in a single
 * query. The depth limit doesn't help — list explosion is breadth, not
 * depth. We walk every Field's `limit` argument and clip it inline.
 *
 * Anonymous reads are already access-filtered at the collection level,
 * so this prevents the public catalog from being scraped in big chunks
 * via a single GraphQL POST.
 */
export function createMaxLimitRule(maxLimit = 100): ValidationRule {
  return function maxLimitRule(context) {
    return {
      Argument(node) {
        if (node.name.value !== 'limit') return
        if (node.value.kind !== 'IntValue') return
        const v = parseInt(node.value.value, 10)
        if (!Number.isFinite(v) || v <= maxLimit) return
        context.reportError(
          new GraphQLError(`limit ${v} exceeds the maximum of ${maxLimit}.`),
        )
      },
    }
  }
}

/**
 * B75: Block GraphQL schema introspection in production.
 *
 * The Playground UI is already 404'd in prod (see graphql-playground/route.ts),
 * but the POST endpoint still answers `{ __schema { types { name fields ... } } }`
 * and reveals the full collection/field map to anyone who hits it. Attackers
 * use that to enumerate access-controlled fields, find typoed permissions,
 * and craft targeted queries. In dev we keep introspection on so IDE tooling
 * (codegen, schema-aware editors) keeps working.
 */
export const blockIntrospectionInProduction: ValidationRule = (context) => ({
  Field(node) {
    if (process.env.NODE_ENV !== 'production') return
    const name = node.name.value
    if (name === '__schema' || name === '__type') {
      context.reportError(
        new GraphQLError('GraphQL introspection is disabled in production.'),
      )
    }
  },
})
