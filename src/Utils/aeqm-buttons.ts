/**
 * @aeqm/baileys — buttons and interactive messages.
 *
 * Official Baileys 7.x cannot send `buttons`, `sections`, and similar content. This file
 * contains the pure logic (with no runtime dependencies) that converts `sendMessage`
 * content into protobuf-compatible structures and determines which binary "biz" nodes
 * are needed for WhatsApp to render them.
 *
 * Formats accepted by sendMessage(jid, content):
 *
 *  1) ChatUnity-style quick-reply buttons (used by Hastur):
 *       { text|caption, footer, buttons: [{ buttonId, buttonText: { displayText } }] }
 *     (also works with image/video/document headers)
 *
 *  2) Extended interactive buttons:
 *       { text, footer, interactiveButtons: [
 *           { type: 'reply', text: 'Ok',      id: '.menu' },
 *           { type: 'url',   text: 'Site',    url: 'https://…' },
 *           { type: 'copy',  text: 'Copy',   code: 'ABC123' },
 *           { type: 'call',  text: 'Call',  phone: '+39…' },
 *           { type: 'list',  text: 'Choose',  sections: [...] },
 *           { name: 'quick_reply', buttonParamsJson: '{"display_text":"x","id":"y"}' }   // raw format
 *       ] }
 *
 *  3) List (dropdown menu):
 *       { text, footer, title, buttonText: 'Open menu',
 *         sections: [{ title, rows: [{ title, description, rowId }] }] }
 *
 *  Options:
 *    buttonsMode: 'native_flow' (default) | 'legacy'
 *      - native_flow: interactive message (nativeFlowMessage), the format currently rendered by
 *        WhatsApp clients.
 *      - legacy: legacy buttonsMessage (only useful if a client still supports it).
 */

import type { BinaryNode } from '../WABinary/types'

export type AeqmButtonsMode = 'native_flow' | 'legacy'

export type NativeFlowButton = { name: string; buttonParamsJson: string }

const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : v == null ? fallback : String(v))

/** Returns true when sendMessage content needs to be converted into an interactive message. */
export const hasInteractiveContent = (content: any): boolean => {
	if (!isObj(content)) return false
	if (Array.isArray(content.buttons) && content.buttons.length > 0) return true
	if (Array.isArray(content.interactiveButtons) && content.interactiveButtons.length > 0) return true
	if (Array.isArray(content.sections) && content.sections.length > 0) return true
	return false
}

// ---------------------------------------------------------------------------
//  Individual buttons
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

/** Converts a button from any supported input shape to the nativeFlow format. */
export const toNativeFlowButton = (b: any): NativeFlowButton | null => {
	if (!isObj(b)) return null

	// Already in the raw format.
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
			// ChatUnity format: { buttonId, buttonText: { displayText } }
			// Short format:     { id, text }
			const id = str(b.buttonId ?? b.id)
			if (!text && !id) return null
			return quickReply(text || id, id || text)
		}
	}
}

/**
 * Collects all buttons in the content (`buttons` + `interactiveButtons` + any
 * `sections` list) into a nativeFlow array.
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
//  Message construction
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

/** Builds the `interactiveMessage` object (with nativeFlowMessage). */
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

/** Wraps the `interactiveMessage` in the structure expected by clients. */
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

/** Legacy `buttonsMessage` (quick replies only). Used only with buttonsMode: 'legacy'. */
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
//  "biz" binary nodes: without these, WhatsApp drops or ignores the buttons
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
 * Returns the extra nodes to append to the stanza for an interactive message, or
 * `[]` if the message does not need any.
 *
 * @param message Message already normalized (without a viewOnce wrapper).
 * @param isPrivateChat `true` for a 1:1 chat (not a group or broadcast).
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

/** Extracts the selected button ID from a reply message (useful for bots). */
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
