import { DEFAULT_CONNECTION_CONFIG } from '../Defaults'
import type { UserFacingSocketConfig } from '../Types'
import { applyAeqmCompat } from './aeqm'
import { makeCommunitiesSocket } from './communities'

// export the last socket layer
const makeWASocket = (config: UserFacingSocketConfig) => {
	const newConfig = {
		...DEFAULT_CONNECTION_CONFIG,
		...config
	}

	// [@aeqm/baileys] strato di compatibilità (pulsanti, LID helpers, eventi legacy)
	return applyAeqmCompat(makeCommunitiesSocket(newConfig), config.aeqm)
}

export default makeWASocket
