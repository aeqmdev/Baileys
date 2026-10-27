import { proto } from '../../../WAProto/index.js'
import { generateWAMessageContent } from '../../Utils/messages'

describe('message generation additions', () => {
	it.each([proto.KeepType.KEEP_FOR_ALL, proto.KeepType.UNDO_KEEP_FOR_ALL])('encodes Keep in Chat action %s', async type => {
		const key = { remoteJid: '123@s.whatsapp.net', id: 'message-id', fromMe: false }
		const message = await generateWAMessageContent({ keep: key, type }, { upload: async () => ({ mediaUrl: '', directPath: '' }) })
		expect(message.keepInChatMessage?.key).toEqual(key)
		expect(message.keepInChatMessage?.keepType).toBe(type)
	})

	it('encodes quiz polls as V5', async () => {
		const message = await generateWAMessageContent({ poll: { name: 'Question', values: ['A', 'B'], selectableCount: 1, pollType: proto.Message.PollType.QUIZ, correctAnswer: 'B' } }, { upload: async () => ({ mediaUrl: '', directPath: '' }), jid: '123@newsletter' })
		expect(message.pollCreationMessageV5?.pollType).toBe(proto.Message.PollType.QUIZ)
		expect(message.pollCreationMessageV5?.correctAnswer?.optionName).toBe('B')
	})
})
