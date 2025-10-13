import * as vscode from 'vscode';
import { z } from 'zod';

/**
 * Strongly-typed extension configuration with validation.
 */
export interface AppConfig {
	readonly serverUrl: string;
}

const ConfigSchema = z.object({
	serverUrl: z
		.string()
		.trim()
		.min(1)
		.refine((url) => /^https?:\/\//i.test(url), {
			message: 'serverUrl must start with http:// or https://',
		}),
});

export function readConfig(): AppConfig {
	const cfg = vscode.workspace.getConfiguration('thinkingLogger');
	const raw = {
		serverUrl: (cfg.get<string>('serverUrl') || 'http://127.0.0.1:17890').trim(),
	};
	const parsed = ConfigSchema.safeParse(raw);
	if (!parsed.success) {
		// Fallback to default while surfacing details to developers via Output
		return { serverUrl: 'http://127.0.0.1:17890' };
	}
	return parsed.data;
}


