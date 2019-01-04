import {diffArrays} from 'diff';
import got from 'got';
import loadJson from 'load-json-file';
import {isEqual} from 'lodash';
import path from 'path';
import writeJson, {JSONStringifyable} from 'write-json-file';

const SCHEDULE_URL =
	'https://gamesdonequick.com/tracker/search/?type=run&event=25';
const GDQ_ICON_URL = 'https://gamesdonequick.com/static/res/img/gdqlogo.png';
const SCHEDULE_CHECK_INTERVAL_MS = 10 * 60 * 1000;

namespace GdqSchedule {
	export interface RawData {
		pk: number;
		fields: {
			category: string;
			coop: boolean;
			console: string;
			name: string;
			setup_time: string;
			order: number;
			deprecated_runners: string;
			runners: number[];
		};
	}

	export interface ParsedData {
		pk: number;
		name: string;
		category: string;
		coop: boolean;
		console: string;
		order: number;
		deprecated_runners: string;
	}

	export const parse = (rawData: RawData[]): ParsedData[] => {
		return rawData.map(
			(item): ParsedData => {
				return {
					pk: item.pk,
					category: item.fields.category,
					coop: item.fields.coop,
					console: item.fields.console,
					name: item.fields.name,
					order: item.fields.order,
					deprecated_runners: item.fields.deprecated_runners,
				};
			},
		);
	};
}

namespace Comparator {
	interface ComparisonResult {
		added?: boolean;
		removed?: boolean;
		value: GdqSchedule.ParsedData;
	}

	export const compare = (
		oldData: GdqSchedule.ParsedData[],
		newData: GdqSchedule.ParsedData[],
	): ComparisonResult[] => {
		const diffArrayResult = diffArrays(oldData, newData, {
			comparator: isEqual,
		});
		return diffArrayResult.reduce<ComparisonResult[]>((mem, diff) => {
			if (diff.added) {
				const addedRuns = diff.value.map(diffValue => {
					return {
						added: true,
						value: diffValue,
					};
				});
				return [...mem, ...addedRuns];
			}
			if (diff.removed) {
				const removedRuns = diff.value.map(diffValue => {
					return {
						removed: true,
						value: diffValue,
					};
				});
				return [...mem, ...removedRuns];
			}
			return mem;
		}, []);
	};
}

namespace Discord {
	const {DISCORD_WEBHOOK_URL: WEBHOOK_URL} = process.env;
	if (!WEBHOOK_URL) {
		throw new Error('Missing environment variable DISCORD_WEBHOOK_URL');
	}

	export interface EmbedMessage {
		title?: string;
		type?: string;
		description?: string;
		url?: string;
		timestamp?: Date;
		color?: number;
		footer?: {
			text?: string;
			icon_url?: string;
			proxy_icon_url?: string;
		};
		image?: {
			url?: string;
			proxy_url?: string;
			height?: number;
			width?: number;
		};
		thumbnail?: {
			url?: string;
			proxy_url?: string;
			height?: number;
			width?: number;
		};
		video?: {
			url?: string;
			height?: number;
			width?: number;
		};
		provider?: {
			name?: string;
			url?: string;
		};
		author?: {
			name?: string;
			url?: string;
			icon_url?: string;
			proxy_icon_url?: string;
		};
		fields?: Array<{
			name?: string;
			value?: string;
			inline?: boolean;
		}>;
	}

	export const sendEmbeds = async (embedMessages: EmbedMessage[]) => {
		await got.post(WEBHOOK_URL, {
			body: {embeds: embedMessages},
			json: true,
		});
	};

	export const sendMessages = async (message: string) => {
		await got.post(WEBHOOK_URL, {
			body: {content: message},
			json: true,
		});
	};
}

namespace Db {
	const dbPath = path.resolve(__dirname, 'db/schedule.json');

	export const write = async <T extends JSONStringifyable>(data: T) => {
		await writeJson(dbPath, data);
	};

	export const load = async (): Promise<
		GdqSchedule.ParsedData[] | undefined
	> => {
		try {
			const data = await loadJson(dbPath);
			return data as GdqSchedule.ParsedData[];
		} catch (error) {
			if (error.code === 'ENOENT') {
				return undefined;
			}
			throw error;
		}
	};
}

const main = async () => {
	try {
		console.log(`Starting new loop: ${new Date().toISOString()}`);
		const [oldData, res] = await Promise.all([
			Db.load(),
			got.get(SCHEDULE_URL, {json: true}),
		]);
		const newData = GdqSchedule.parse(res.body);
		console.log(`Fetched new schedule with ${newData.length} runs`);
		if (oldData) {
			const diffs = Comparator.compare(oldData, newData);
			if (diffs.length > 0) {
				console.log(`${diffs.length} changes are detected`);
				const embeds: Discord.EmbedMessage = {
					title: 'GDQ Schedule Changed',
					author: {
						url: SCHEDULE_URL,
						icon_url: GDQ_ICON_URL,
					},
					fields: diffs.map(diff => {
						const name = diff.added
							? 'Run Added'
							: diff.removed
							? 'Run Removed'
							: 'UNKNOWN';
						return {
							name,
							value: diff.value.name,
							inline: false,
						};
					}),
				};
				await Discord.sendEmbeds([embeds]);
			} else {
				console.log('No change are detected');
			}
		} else {
			console.log(`First time to fetch the schedule`);
			await Discord.sendMessages(
				'GDQ schedule change notifier is setup and ready!',
			);
		}
		await Db.write(newData);
		console.log('Done');
		console.log();
	} catch (error) {
		console.error(error);
	}
};

main();
setInterval(main, SCHEDULE_CHECK_INTERVAL_MS);
