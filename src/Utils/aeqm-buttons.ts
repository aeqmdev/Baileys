/**
 * @aeqm/baileys — pulsanti e messaggi interattivi.
 *
 * Il Baileys ufficiale 7.x non sa inviare `buttons`, `sections` ecc. Qui c'è la
 * parte "pura" (senza dipendenze runtime) che converte il contenuto di
 * sendMessage in strutture protobuf-compatibili e decide quali nodi binari "biz"
 * servono perché WhatsApp li renderizzi.
 *
 * Formati accettati dentro sendMessage(jid, content):
 *
 *  1) Pulsanti "quick reply" in stile ChatUnity (è ciò che usa Hastur):
 *       { text|caption, footer, buttons: [{ buttonId, buttonText: { displayText } }] }
 *     (funziona anche con image/video/document come header)
 *
 *  2) Pulsanti interattivi estesi:
 *       { text, footer, interactiveButtons: [
 *           { type: 'reply', text: 'Ok',      id: '.menu' },
 *           { type: 'url',   text: 'Sito',    url: 'https://…' },
 *           { type: 'copy',  text: 'Copia',   code: 'ABC123' },
 *           { type: 'call',  text: 'Chiama',  phone: '+39…' },
 *           { type: 'list',  text: 'Scegli',  sections: [...] },
 *           { name: 'quick_reply', buttonParamsJson: '{"display_text":"x","id":"y"}' }   // grezzo
 *       ] }
 *
 *  3) Lista (menu a tendina):
 *       { text, footer, title, buttonText: 'Apri menu',
 *         sections: [{ title, rows: [{ title, description, rowId }] }] }
 *
 *  Opzioni:
 *    buttonsMode: 'native_flow' (default) | 'legacy'
 *      - native_flow: messaggio interattivo (nativeFlowMessage), il formato che i
 *        client WhatsApp attuali mostrano.
 *      - legacy: vecchio buttonsMessage (utile solo se un client lo supporta ancora).
 */

import type { BinaryNode } from '../WABinary/types'

export type AeqmButtonsMode = 'native_flow' | 'legacy'

export type NativeFlowButton = { name: string; buttonParamsJson: string }

const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : v == null ? fallback : String(v))

/** Vero se il contenuto di sendMessage richiede di essere trasformato in messaggio interattivo. */
export const hasInteractiveContent = (content: any): boolean => {
	if (!isObj(content)) return false
	if (Array.isArray(content.buttons) && content.buttons.length > 0) return true
	if (Array.isArray(content.interactiveButtons) && content.interactiveButtons.length > 0) return true
	if (Array.isArray(content.sections) && content.sections.length > 0) return true
	return false
}

// ---------------------------------------------------------------------------
//  Singoli pulsanti
// ---------------------------------------------------------------------------

const quickReply = (text: string, id: string): NativeFlowButton => ({
	name: 'quick_reply',
	buttonParamsJson: JSON.stringify({ display_text: text, id })
})

type RowInput = { title?: string; description?: string; rowId?: string; id?: string; header?: string }
type SectionInput = { title?: string; highlight_label?: string; highlightLabel?: string; rows?: RowInput[] }

const buildSingleSelect = (label: string, sections: SectionInput[]): NativeFlowButton => ({
	name: 'single_select',
	buttonParamsJson: JSON.stringify({
		title: label,
		sections: (sections || []).map(s => ({
			title: str(s.title),
			highlight_label: str(s.highlight_label ?? s.highlightLabel),
			rows: (s.rows || []).map(r => ({
				header: str(r.header),
				title: str(r.title),
				description: str(r.description),
				id: str(r.id ?? r.rowId)
			}))
		}))
	})
})

/** Converte un pulsante in qualunque forma accettata nel formato nativeFlow. */
export const toNativeFlowButton = (b: any): NativeFlowButton | null => {
	if (!isObj(b)) return null

	// Già nel formato grezzo.
	if (typeof b.name === 'string' && b.name && (b.buttonParamsJson !== undefined || b.params !== undefined)) {
		const raw = b.buttonParamsJson !== undefined ? b.buttonParamsJson : b.params
		return { name: b.name, buttonParamsJson: typeof raw === 'string' ? raw : JSON.stringify(raw) }
	}

	const type = str(b.type).toLowerCase()
	const text = str(b.text ?? b.displayText ?? b.display_text ?? b.buttonText?.displayText)

	switch (type) {
		case 'url':
		case 'cta_url': {
			const url = str(b.url)
			return {
				name: 'cta_url',
				buttonParamsJson: JSON.stringify({ display_text: text, url, merchant_url: str(b.merchantUrl ?? b.merchant_url, url) })
			}
		}

		case 'copy':
		case 'cta_copy':
			return {
				name: 'cta_copy',
				buttonParamsJson: JSON.stringify({ display_text: text, copy_code: str(b.code ?? b.copyCode ?? b.copy_code) })
			}

		case 'call':
		case 'cta_call':
			return {
				name: 'cta_call',
				buttonParamsJson: JSON.stringify({ display_text: text, phone_number: str(b.phone ?? b.phoneNumber ?? b.phone_number) })
			}

		case 'list':
		case 'single_select':
			return buildSingleSelect(text || str(b.title, 'Menu'), b.sections || [])

		case 'reply':
		case 'quick_reply':
		default: {
			// Forma ChatUnity: { buttonId, buttonText: { displayText } }
			// Forma breve:     { id, text }
			const id = str(b.buttonId ?? b.id)
			if (!text && !id) return null
			return quickReply(text || id, id || text)
		}
	}
}

/**
 * Raccoglie tutti i pulsanti presenti nel contenuto (buttons + interactiveButtons +
 * eventuale lista `sections`) come array nativeFlow.
 */
export const collectNativeFlowButtons = (content: any): NativeFlowButton[] => {
	const out: NativeFlowButton[] = []

	if (Array.isArray(content.buttons)) {
		for (const b of content.buttons) {
			const nf = toNativeFlowButton(b)
			if (nf) out.push(nf)
		}
	}

	if (Array.isArray(content.interactiveButtons)) {
		for (const b of content.interactiveButtons) {
			const nf = toNativeFlowButton(b)
			if (nf) out.push(nf)
		}
	}

	if (Array.isArray(content.sections) && content.sections.length > 0) {
		const label = str(content.buttonText ?? content.listButtonText ?? content.listTitle, 'Menu')
		out.push(buildSingleSelect(label, content.sections))
	}

	return out
}

// ---------------------------------------------------------------------------
//  Costruzione del messaggio
// ---------------------------------------------------------------------------

export type MediaHeader = {
	imageMessage?: any
	videoMessage?: any
	documentMessage?: any
}

export type BuildInteractiveInput = {
	body?: string
	footer?: string
	title?: string
	subtitle?: string
	buttons: NativeFlowButton[]
	media?: MediaHeader
	mentions?: string[]
	contextInfo?: Record<string, any>
	messageParamsJson?: string
}

/** Costruisce l'oggetto `interactiveMessage` (con nativeFlowMessage). */
export const buildInteractiveMessage = (input: BuildInteractiveInput) => {
	const hasMedia = !!(input.media?.imageMessage || input.media?.videoMessage || input.media?.documentMessage)

	const header: Record<string, any> = {
		title: input.title || '',
		subtitle: input.subtitle || '',
		hasMediaAttachment: hasMedia
	}
	if (input.media?.imageMessage) header.imageMessage = input.media.imageMessage
	else if (input.media?.videoMessage) header.videoMessage = input.media.videoMessage
	else if (input.media?.documentMessage) header.documentMessage = input.media.documentMessage

	const message: Record<string, any> = {
		header,
		body: { text: input.body || (hasMedia ? '' : ' ') },
		nativeFlowMessage: {
			buttons: input.buttons,
			messageParamsJson: input.messageParamsJson ?? '',
			messageVersion: 1
		}
	}

	if (input.footer) message.footer = { text: input.footer }

	const ctx: Record<string, any> = { ...(input.contextInfo || {}) }
	if (input.mentions?.length) ctx.mentionedJid = input.mentions
	if (Object.keys(ctx).length) message.contextInfo = ctx

	return message
}

/** Avvolge l'interactiveMessage nella struttura che i client si aspettano. */
export const wrapInteractiveMessage = (interactiveMessage: Record<string, any>) => ({
	viewOnceMessage: {
		message: {
			messageContextInfo: {
				deviceListMetadata: {},
				deviceListMetadataVersion: 2
			},
			interactiveMessage
		}
	}
})

/** Vecchio `buttonsMessage` (solo quick reply). Usato solo con buttonsMode: 'legacy'. */
export const buildLegacyButtonsMessage = (input: {
	body?: string
	footer?: string
	buttons: NativeFlowButton[]
	media?: MediaHeader
	mentions?: string[]
	contextInfo?: Record<string, any>
}) => {
	const replies = input.buttons
		.filter(b => b.name === 'quick_reply')
		.map(b => {
			const p = JSON.parse(b.buttonParamsJson)
			return { buttonId: str(p.id), buttonText: { displayText: str(p.display_text) }, type: 1 }
		})

	const msg: Record<string, any> = {
		contentText: input.body || ' ',
		footerText: input.footer || '',
		buttons: replies,
		headerType: 1 // EMPTY
	}

	if (input.media?.imageMessage) {
		msg.imageMessage = input.media.imageMessage
		msg.headerType = 4
	} else if (input.media?.videoMessage) {
		msg.videoMessage = input.media.videoMessage
		msg.headerType = 5
	} else if (input.media?.documentMessage) {
		msg.documentMessage = input.media.documentMessage
		msg.headerType = 3
	}

	const ctx: Record<string, any> = { ...(input.contextInfo || {}) }
	if (input.mentions?.length) ctx.mentionedJid = input.mentions
	if (Object.keys(ctx).length) msg.contextInfo = ctx

	return msg
}

// ---------------------------------------------------------------------------
//  Nodi binari "biz": senza questi WhatsApp scarta/ignora i pulsanti
// ---------------------------------------------------------------------------

const NATIVE_FLOW_SPECIALS = new Set([
	'mpm',
	'cta_catalog',
	'send_location',
	'call_permission_request',
	'wa_payment_transaction_details',
	'automated_greeting_message_view_catalog'
])

/**
 * Restituisce i nodi aggiuntivi da accodare allo stanza per un messaggio
 * interattivo, oppure [] se il messaggio non ne ha bisogno.
 *
 * @param message messaggio già "normalizzato" (senza wrapper viewOnce)
 * @param isPrivateChat true per chat 1:1 (non gruppo/broadcast)
 */
export const getInteractiveBizNodes = (message: any, isPrivateChat: boolean): BinaryNode[] => {
	if (!isObj(message)) return []

	const nativeFlow = message.interactiveMessage?.nativeFlowMessage
	const firstName: string | undefined = nativeFlow?.buttons?.[0]?.name

	let biz: BinaryNode | undefined

	if (nativeFlow && (firstName === 'review_and_pay' || firstName === 'payment_info')) {
		biz = {
			tag: 'biz',
			attrs: { native_flow_name: firstName === 'review_and_pay' ? 'order_details' : firstName }
		}
	} else if (nativeFlow && firstName && NATIVE_FLOW_SPECIALS.has(firstName)) {
		biz = {
			tag: 'biz',
			attrs: {},
			content: [
				{
					tag: 'interactive',
					attrs: { type: 'native_flow', v: '1' },
					content: [{ tag: 'native_flow', attrs: { v: '2', name: firstName } }]
				}
			]
		}
	} else if (nativeFlow || message.buttonsMessage) {
		biz = {
			tag: 'biz',
			attrs: {},
			content: [
				{
					tag: 'interactive',
					attrs: { type: 'native_flow', v: '1' },
					content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }]
				}
			]
		}
	} else if (message.listMessage) {
		biz = {
			tag: 'biz',
			attrs: {},
			content: [{ tag: 'list', attrs: { v: '2', type: 'product_list' } }]
		}
	}

	if (!biz) return []

	const nodes: BinaryNode[] = [biz]
	if (isPrivateChat) nodes.push({ tag: 'bot', attrs: { biz_bot: '1' } })
	return nodes
}

/** Estrae l'id del pulsante premuto da un messaggio di risposta (utile ai bot). */
export const getButtonReplyId = (message: any): string | null => {
	if (!isObj(message)) return null
	const m = message
	const direct =
		m.buttonsResponseMessage?.selectedButtonId ||
		m.templateButtonReplyMessage?.selectedId ||
		m.listResponseMessage?.singleSelectReply?.selectedRowId
	if (direct) return direct as string

	const params = m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson
	if (params) {
		try {
			const parsed = JSON.parse(params)
			return parsed?.id ?? parsed?.selectedRowId ?? null
		} catch {
			return null
		}
	}

	return null
}
