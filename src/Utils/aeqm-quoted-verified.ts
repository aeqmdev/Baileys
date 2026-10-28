import { randomBytes } from 'crypto'
import type { WAContextInfo } from '../Types/Message'

export type QuotedVerifiedOptions = {
	/** Remote JID attached to the synthetic quoted message. Defaults to `status@broadcast`. */
	remoteJid?: string
	/** Optional JPEG thumbnail displayed with the quoted location. */
	thumbnail?: Uint8Array
}

/**
 * Builds a synthetic quoted-message context containing a location whose name is `text`.
 * Some WhatsApp clients may render its participant as the official WhatsApp account.
 * This does not verify an account or message, and the display is client-dependent.
 */
export const quotedVerified = (text: string, options: QuotedVerifiedOptions = {}): WAContextInfo => ({
	stanzaId: `BAE5${randomBytes(6).toString('hex').toUpperCase()}`,
	participant: '0@s.whatsapp.net',
	remoteJid: options.remoteJid || 'status@broadcast',
	quotedMessage: {
		locationMessage: {
			name: text,
			degreesLatitude: 0,
			degreesLongitude: 0,
			...(options.thumbnail ? { jpegThumbnail: options.thumbnail } : {})
		}
	}
})
