import type { AeqmInteractiveButton, AeqmLegacyButton } from '../../Types'
import {
	buildLegacyButtonsMessage,
	collectNativeFlowButtons,
	getButtonReplyId,
	hasInteractiveContent,
	toNativeFlowButton
} from '../../Utils/aeqm-buttons'

// These tests pin the shapes described by the README and by the AeqmInteractiveButton / AeqmLegacyButton types
// to the output of the pure conversion helpers. They do not exercise sending: how WhatsApp renders buttons
// is checked manually.

type DocumentedButton = {
	button: AeqmInteractiveButton
	name: string
	params: Record<string, unknown>
}

const replyParams = { display_text: 'Ok', id: '.menu' }
const copyParams = { display_text: 'Copy', copy_code: 'ABC123' }
const callParams = { display_text: 'Call', phone_number: '+390000000000' }

const documentedButtons: DocumentedButton[] = [
	{ button: { type: 'reply', text: 'Ok', id: '.menu' }, name: 'quick_reply', params: replyParams },
	{ button: { type: 'quick_reply', text: 'Ok', id: '.menu' }, name: 'quick_reply', params: replyParams },
	{
		button: { type: 'url', text: 'Site', url: 'https://example.com' },
		name: 'cta_url',
		params: { display_text: 'Site', url: 'https://example.com', merchant_url: 'https://example.com' }
	},
	{
		button: { type: 'cta_url', text: 'Site', url: 'https://example.com', merchantUrl: 'https://merchant.example.com' },
		name: 'cta_url',
		params: { display_text: 'Site', url: 'https://example.com', merchant_url: 'https://merchant.example.com' }
	},
	{ button: { type: 'copy', text: 'Copy', code: 'ABC123' }, name: 'cta_copy', params: copyParams },
	{ button: { type: 'cta_copy', text: 'Copy', code: 'ABC123' }, name: 'cta_copy', params: copyParams },
	{ button: { type: 'call', text: 'Call', phone: '+390000000000' }, name: 'cta_call', params: callParams },
	{ button: { type: 'cta_call', text: 'Call', phone: '+390000000000' }, name: 'cta_call', params: callParams },
	{
		button: { name: 'quick_reply', buttonParamsJson: '{"display_text":"x","id":"y"}' },
		name: 'quick_reply',
		params: { display_text: 'x', id: 'y' }
	}
]

type SingleSelectParams = {
	title: string
	sections: { title: string; highlight_label: string; rows: Record<string, string>[] }[]
}

describe('toNativeFlowButton', () => {
	for (const { button, name, params } of documentedButtons) {
		const label = 'type' in button ? button.type : 'raw'

		it(`maps the documented ${label} button to ${name}`, () => {
			const converted = toNativeFlowButton(button)

			expect(converted?.name).toBe(name)
			expect(JSON.parse(converted?.buttonParamsJson ?? 'null')).toEqual(params)
		})
	}

	it('maps the documented list button to single_select with its rows', () => {
		const list: AeqmInteractiveButton = {
			type: 'list',
			text: 'Choose',
			sections: [{ title: 'A', rows: [{ title: 'r1', description: 'd', rowId: 'id1' }] }]
		}

		const converted = toNativeFlowButton(list)
		const params = JSON.parse(converted?.buttonParamsJson ?? 'null') as SingleSelectParams

		expect(converted?.name).toBe('single_select')
		expect(params.title).toBe('Choose')
		expect(params.sections[0]?.title).toBe('A')
		expect(params.sections[0]?.rows[0]).toEqual({ header: '', title: 'r1', description: 'd', id: 'id1' })
	})

	it('maps the documented legacy quick reply form to quick_reply', () => {
		const legacy: AeqmLegacyButton = { buttonId: '.menu admin', buttonText: { displayText: 'Admin' } }

		const converted = toNativeFlowButton(legacy)

		expect(converted?.name).toBe('quick_reply')
		expect(JSON.parse(converted?.buttonParamsJson ?? 'null')).toEqual({ display_text: 'Admin', id: '.menu admin' })
	})

	it('ignores values that are not buttons', () => {
		expect(toNativeFlowButton(null)).toBeNull()
		expect(toNativeFlowButton('ok')).toBeNull()
		expect(toNativeFlowButton({})).toBeNull()
	})
})

describe('hasInteractiveContent', () => {
	it('recognizes the documented content forms', () => {
		const legacy: AeqmLegacyButton = { buttonId: 'a', buttonText: { displayText: 'A' } }

		expect(hasInteractiveContent({ text: 'x', buttons: [legacy] })).toBe(true)
		expect(hasInteractiveContent({ text: 'x', interactiveButtons: [{ type: 'reply', text: 'A', id: 'a' }] })).toBe(true)
		expect(hasInteractiveContent({ text: 'x', buttonText: 'Open', sections: [{ rows: [{ title: 'r' }] }] })).toBe(true)
	})

	it('does not treat plain or empty content as interactive', () => {
		expect(hasInteractiveContent({ text: 'x' })).toBe(false)
		expect(hasInteractiveContent({ text: 'x', buttons: [], interactiveButtons: [], sections: [] })).toBe(false)
		expect(hasInteractiveContent(null)).toBe(false)
		expect(hasInteractiveContent('x')).toBe(false)
	})
})

describe('collectNativeFlowButtons', () => {
	it('collects buttons, then interactiveButtons, then the list', () => {
		const legacy: AeqmLegacyButton = { buttonId: 'a', buttonText: { displayText: 'A' } }

		const collected = collectNativeFlowButtons({
			buttons: [legacy],
			interactiveButtons: [{ type: 'reply', text: 'B', id: 'b' }],
			buttonText: 'Open',
			sections: [{ title: 'S', rows: [{ title: 'r', rowId: 'id1' }] }]
		})

		expect(collected.map(b => b.name)).toEqual(['quick_reply', 'quick_reply', 'single_select'])
		expect((JSON.parse(collected[2]?.buttonParamsJson ?? 'null') as SingleSelectParams).title).toBe('Open')
	})
})

describe('getButtonReplyId', () => {
	it('reads the id from each documented response message', () => {
		expect(getButtonReplyId({ buttonsResponseMessage: { selectedButtonId: '.b' } })).toBe('.b')
		expect(getButtonReplyId({ templateButtonReplyMessage: { selectedId: '.t' } })).toBe('.t')
		expect(getButtonReplyId({ listResponseMessage: { singleSelectReply: { selectedRowId: '.l' } } })).toBe('.l')
		expect(
			getButtonReplyId({ interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: '{"id":".n"}' } } })
		).toBe('.n')
		expect(
			getButtonReplyId({
				interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: '{"selectedRowId":".r"}' } }
			})
		).toBe('.r')
	})

	it('returns null when there is no usable id', () => {
		expect(getButtonReplyId({ conversation: 'x' })).toBeNull()
		expect(
			getButtonReplyId({ interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: 'not json' } } })
		).toBeNull()
		expect(getButtonReplyId(null)).toBeNull()
		expect(getButtonReplyId(undefined)).toBeNull()
	})
})

describe('buildLegacyButtonsMessage', () => {
	it('keeps only the quick reply buttons, as documented for buttonsMode legacy', () => {
		const message = buildLegacyButtonsMessage({
			body: 'Choose',
			buttons: [
				{ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'A', id: 'a' }) },
				{ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: 'S', url: 'https://example.com' }) }
			]
		})

		expect(message.buttons).toEqual([{ buttonId: 'a', buttonText: { displayText: 'A' }, type: 1 }])
	})
})
