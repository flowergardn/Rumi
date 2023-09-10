import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	ButtonBuilder,
	ButtonInteraction,
	ButtonStyle,
	CommandInteraction,
	EmbedBuilder,
	SelectMenuBuilder,
	SelectMenuInteraction,
	bold,
	spoiler
} from 'discord.js';
import { ButtonComponent, Discord, SelectMenuComponent, Slash, SlashOption } from 'discordx';
import axios from 'axios';
import { prisma } from '..';

// The length of games within seconds
const GAME_LENGTH = 120;
// The cooldown applied to the game for each lyric
const LYRIC_COOLDOWN = 20;
// The cooldown applied to each user, per game, for each guess.
const GUESS_COOLDOWN = 5;

const random = (array: string[]): string => array[Math.floor(Math.random() * array.length)];

import NodeCache from 'node-cache';
import shuffleArray from '../lib/shuffle';
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

		let artist;

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

		console.log(`chose ${song}`);

		const randomLyrics = getRandomLyric(songLyrics);

		const embed = new EmbedBuilder().setTitle('Guess the song!');
		embed.setDescription(randomLyrics);
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

		const decoys = [random(songs), random(songs), song];

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
			content: `Started game! Name of song is: ${spoiler(song)}`
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
			song,
			allLyrics: songLyrics,
			currentLyrics: randomLyrics,
			timer: timeout
		});
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
			console.log(msg.embeds);
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
			// TODO: Add a cooldown for guessing.
			await interaction.reply({
				content: `You didn't get it. Try again soon!`,
				ephemeral: true
			});
		}

		console.log(`person chose ${songTitle}, song is titled ${gameInfo.song}`);
	}
}
