import dotenv from 'dotenv'

dotenv.config()

export const config = {
  port: Number(process.env.PORT) || 3000,
  issuer: process.env.TOKEN_ISSUER || 'shiftlite',
  privateKey: process.env.PRIVATE_KEY,
}
