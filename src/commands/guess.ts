import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	ButtonBuilder,
	ButtonInteraction,
	ButtonStyle,
	CommandInteraction,
	EmbedBuilder,
	GuildTextBasedChannel,
	Message,
	SelectMenuBuilder,
	SelectMenuInteraction,
	bold,
	inlineCode,
	spoiler
} from 'discord.js';
import { ButtonComponent, Discord, SelectMenuComponent, Slash, SlashOption } from 'discordx';
import axios from 'axios';
import { prisma } from '..';
import util from 'util';

// The length of games within seconds
const GAME_LENGTH = 120;
// The cooldown applied to the game for each lyric
const LYRIC_COOLDOWN = 20;
// The cooldown applied to each user, per game, for each guess.
const GUESS_COOLDOWN = 5;

const random = (array: string[]): string => array[Math.floor(Math.random() * array.length)];

import NodeCache from 'node-cache';
import shuffleArray from '../lib/shuffle';
import { Artist } from '@prisma/client';
const gameCache = new NodeCache();

interface GameInfo {
	song: string;
	allLyrics: string;
	currentLyrics: string;
	timer: NodeJS.Timeout;
}

const getRandomLyric = (songLyrics: string) => {
	const verses = songLyrics.split('\n\n');
	const randomVerse = [random(verses), random(verses)].join('\n');
	const randomLyrics = randomVerse.split('\n').slice(0, 4).join('\n');
	return randomLyrics;
};

const getPlayer = async (id: string) => {
	let player = await prisma.member.findUnique({
		where: {
			id: id
		}
	});

	if (player) return player;

	player = await prisma.member.create({
		data: {
			id
		}
	});

	return player;
};

@Discord()
class Game {
	private async sendIntro(artist: Artist, channel: GuildTextBasedChannel): Promise<Message> {
		const introductionEmbed = new EmbedBuilder()
			.setColor('Random')
			.setTitle(`A new game has started!`)
			.setDescription(
				`Members will be given a verse from a random ${inlineCode(
					artist.name
				)} song. The person who selects the right song from three select choices wins. You get a total of **5** hints, which show more lyrics, you in?`
			)
			.setFooter({
				text: `Two people are required to start!`
			});
		const joinBtn = new ButtonBuilder()
			.setLabel('Join the game')
			.setStyle(ButtonStyle.Success)
			.setCustomId('join_game');

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents([joinBtn]);

		const msg = await channel.send({
			embeds: [introductionEmbed],
			components: [row]
		});

		gameCache.set(`gameWaiting-${msg.id}`, []);

		return msg;
	}

	private async startGame(
		interaction: CommandInteraction,
		opt: {
			song: string;
			songs: string[];
			randomLyrics: string;
			lyrics: string;
		}
	) {
		const embed = new EmbedBuilder().setTitle('Guess the song!');
		embed.setDescription(opt.randomLyrics);
		embed.setFooter({
			text: `You have two minutes`
		});
		embed.setTimestamp();

		const getMoreLyrics = new ButtonBuilder()
			.setLabel('Get more lyrics')
			.setStyle(ButtonStyle.Secondary)
			.setCustomId('get_more');

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents([getMoreLyrics]);

		const selectMenu = new SelectMenuBuilder();
		selectMenu.setCustomId(`lyric_guess`);

		const decoys = [random(opt.songs), random(opt.songs), opt.song];

		// shuffled so the winning song isn't always at the bottom
		const opts = shuffleArray(decoys).map((song) => {
			const id = Buffer.from(song).toString('base64');
			console.log(`Adding ${song} to the select menu. (ID: ${id})`);

			return {
				label: song,
				value: id,
				emoji: '🎶'
			};
		});

		selectMenu.setOptions([...new Set(opts)]);

		const row2 = new ActionRowBuilder<SelectMenuBuilder>().addComponents([selectMenu]);

		const msg = await interaction.channel.send({
			embeds: [embed],
			components: [row, row2]
		});

		interaction.editReply({
			content: `Started game! Name of song is: ${spoiler(opt.song)}`
		});

		// Using node-cache expiry was the first solution, it did not work.

		const timeout = setTimeout(() => {
			const keyId = `gameInfo-${msg.id}`;
			const gameInfo: GameInfo = gameCache.get(keyId);

			if (!gameInfo) return;

			const embed = new EmbedBuilder()
				.setTitle('Times up!')
				.setColor('Red')
				.setDescription(`No one guessed the song in time.`)
				.setFields([
					{
						name: 'Song',
						value: gameInfo.song
					}
				]);

			gameCache.del(keyId);

			msg.reply({
				embeds: [embed]
			});
		}, GAME_LENGTH * 1000);

		gameCache.set(`gameInfo-${msg.id}`, {
			song: opt.song,
			allLyrics: opt.lyrics,
			currentLyrics: opt.randomLyrics,
			timer: timeout
		});
	}

	@Slash({ description: 'Start the game' })
	async guess(
		@SlashOption({
			description: 'A specific artist',
			name: 'artist',
			required: false,
			type: ApplicationCommandOptionType.String
		})
		specificArtist: string,
		interaction: CommandInteraction
	) {
		await interaction.deferReply({
			ephemeral: true
		});

		const server = await prisma.server.findUnique({
			where: {
				id: interaction.guildId
			}
		});

		let artist: Artist;

		if (!specificArtist) {
			const artists: string[] = JSON.parse(server.artists);
			const artistId = random(artists);
			artist = await prisma.artist.findUnique({
				where: {
					id: artistId
				}
			});
		} else {
			artist = await prisma.artist.findUnique({
				where: {
					name: specificArtist
				}
			});
		}

		if (!artist) {
			await interaction.editReply({
				content: `An error occured: Chosen artist was not found`
			});
			return;
		}

		const songs: string[] = JSON.parse(artist.songs);
		const song = random(songs);

		let songLyricData: {
			lyrics: string;
		};

		try {
			const response = await axios.get(`https://lyrics.astrid.sh/api/search?q=${encodeURI(song)}`);
			songLyricData = response.data;
		} catch (error) {
			// TODO: ideally remove the song from the artists entry in the database.
			console.error('An error occurred while fetching song lyrics:', error);
			interaction.editReply({
				content: `An eror occured: Failed to fetch lyrics from Genius.`
			});
			return;
		}

		const songLyrics = songLyricData.lyrics;

		const randomLyrics = getRandomLyric(songLyrics);

		const message = await this.sendIntro(artist, interaction.channel);

		const checkInterval = setInterval(() => {
			if (!gameCache.has(`gameWaiting-${message.id}`)) {
				clearInterval(checkInterval); // Stop the interval if the variable is no longer in the cache
				message.delete();
				this.startGame(interaction, {
					song,
					songs,
					randomLyrics,
					lyrics: songLyrics
				});
			}
		}, 1000);
	}

	@ButtonComponent({ id: 'join_game' })
	async joinGame(interaction: ButtonInteraction) {
		const key = `gameWaiting-${interaction.message.id}`;
		let players: string[] = gameCache.get(key);

		if (!players) return;

		console.log(typeof players);

		if (players.includes(interaction.user.id)) return;

		players.push(interaction.user.id);

		gameCache.set(key, players);

		if (players.length >= 2) gameCache.del(key);

		await interaction.deferUpdate();
	}

	@ButtonComponent({ id: /get_more/ })
	async moreLyrics(interaction: ButtonInteraction) {
		const msg = interaction.message;
		const id = msg.id;

		const cd = gameCache.get(`lyricCooldown-${id}`);

		if (typeof cd != 'undefined') {
			interaction.reply({
				content: `A hint was already given out recently!`,
				ephemeral: true
			});
			return;
		}

		const embed = msg.embeds.shift();

		const hints = (embed.description.match(/\n\n/g) || []).length;

		if (hints == 5) {
			interaction.reply({
				content: `Reached the maximum number of hints! (5)`,
				ephemeral: true
			});
			return;
		}

		const gameInfo: GameInfo = gameCache.get(`gameInfo-${id}`);

		if (!gameInfo) return;

		if (!embed) {
			interaction.reply({
				content: `An error occured whilst trying to show a hint!`,
				ephemeral: true
			});
			return;
		}

		const newEmbed = new EmbedBuilder(embed.toJSON());

		let lyrics = getRandomLyric(gameInfo.allLyrics);

		while (lyrics == gameInfo.currentLyrics) {
			lyrics = getRandomLyric(gameInfo.allLyrics);
		}

		newEmbed.setDescription(embed.description + '\n\n' + lyrics);

		msg.edit({
			embeds: [newEmbed]
		});

		gameCache.set(`lyricCooldown-${id}`, true, LYRIC_COOLDOWN);

		interaction.deferUpdate();
	}

	@SelectMenuComponent({ id: /lyric_guess/ })
	async handle(interaction: SelectMenuInteraction) {
		const msg = interaction.message;
		const id = msg.id;

		const gameInfo: GameInfo = gameCache.get(`gameInfo-${id}`);

		if (!gameInfo) return;

		const cooldownKey = `guessCooldown-${id}-${interaction.user.id}`;

		const cd = gameCache.get(cooldownKey);

		if (typeof cd != 'undefined') {
			interaction.reply({
				content: `You've already guessed recently! Wait a moment to recollect your thoughts.`,
				ephemeral: true
			});
			return;
		}

		gameCache.set(cooldownKey, true, GUESS_COOLDOWN);

		const song = interaction.values?.[0];
		let songTitle = new Buffer(song, 'base64').toString('ascii');

		if (songTitle.toLowerCase() == gameInfo.song.toLowerCase()) {
			const hints = (msg.embeds.shift().description.match(/\n\n/g) || []).length;

			const successEmbed = new EmbedBuilder().setColor('Green').setTitle('Game won!');
			successEmbed.setDescription(`${interaction.user.username} guessed the song properly!`);
			successEmbed.setFields([
				{
					name: 'Hints used',
					value: `${hints} hints`
				},
				{
					name: 'Song',
					value: gameInfo.song
				}
			]);

			// await msg.edit({
			// 	embeds: msg.embeds,
			// 	components: []
			// });

			await interaction.reply({
				embeds: [successEmbed]
			});

			// creates the player if it doesn't already exist
			await getPlayer(interaction.user.id);

			const pointsGiven = 10 - hints * 2;

			await prisma.member.update({
				where: {
					id: interaction.user.id
				},
				data: {
					points: {
						increment: pointsGiven
					},
					wins: {
						increment: 1
					}
				}
			});

			// since they're numbers
			const highlight = (text: number) => bold(`${text}`);

			interaction.followUp({
				content: `You earned a total of ${highlight(
					pointsGiven
				)} points for guessing with only ${highlight(hints)} hints.`,
				ephemeral: true
			});

			clearTimeout(gameInfo.timer);
			gameCache.del(`gameInfo-${id}`);
			gameCache.del(cooldownKey);
		} else {
			await interaction.reply({
				content: `You didn't get it. Try again soon!`,
				ephemeral: true
			});
		}
	}
}
