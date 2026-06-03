import config from '@payload-config'
import { GRAPHQL_PLAYGROUND_GET } from '@payloadcms/next/routes'
import { NextResponse, type NextRequest } from 'next/server'

// B59 fix: GraphQL Playground in production discloses the entire schema
// (collections, fields, relationships, access patterns) to anyone who hits
// the URL. We disable it outside dev/test. The GraphQL endpoint itself
// remains live for production clients — only the introspection UI is gated.
const playgroundHandler = GRAPHQL_PLAYGROUND_GET(config)

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return playgroundHandler(req)
}
