import { config } from 'dotenv'

// Igual que server/index.ts: .env y después .env.local. Se importa antes que la base o los providers.
config({ path: '.env', quiet: true })
config({ path: '.env.local', override: true, quiet: true })
