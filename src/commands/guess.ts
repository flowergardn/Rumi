import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonInteraction,
	ButtonStyle,
	CommandInteraction,
	EmbedBuilder,
	SelectMenuBuilder,
	SelectMenuInteraction,
	inlineCode,
	spoiler
} from 'discord.js';
import { ButtonComponent, Discord, SelectMenuComponent, Slash } from 'discordx';
import axios from 'axios';
import { prisma } from '..';

const random = (array: string[]): string => array[Math.floor(Math.random() * array.length)];

import NodeCache from 'node-cache';
import shuffleArray from '../lib/shuffle';
const gameCache = new NodeCache();

const getRandomLyric = (songLyrics: string) => {
	const verses = songLyrics.split('\n\n');

	const randomVerse = random(verses);
	const randomLyrics = randomVerse.split('\n').slice(0, 4).join('\n');
	return randomLyrics;
};

@Discord()
class Game {
	@Slash({ description: 'Start the game' })
	async guess(interaction: CommandInteraction) {
		await interaction.deferReply({
			ephemeral: true
		});

		const server = await prisma.server.findUnique({
			where: {
				id: interaction.guildId
			}
		});

		const artists: string[] = JSON.parse(server.artists);
		const artistId = random(artists);

		const artist = await prisma.artist.findUnique({
			where: {
				id: artistId
			}
		});

		if (!artist) {
			await interaction.editReply({
				content: `An error occured: Chosen artist with ID of ${inlineCode(artistId)} was not found`
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

		gameCache.set(`gameInfo-${msg.id}`, {
			song,
			allLyrics: songLyrics,
			currentLyrics: randomLyrics
		});
	}

	@ButtonComponent({ id: /get_more/ })
	async moreLyrics(interaction: ButtonInteraction) {
		const msg = interaction.message;

		const id = msg.id;

		const gameInfo: {
			song: string;
			allLyrics: string;
			currentLyrics: string;
		} = gameCache.get(`gameInfo-${id}`);

		if (!gameInfo) return;

		const embed = msg.embeds.shift();

		const newEmbed = new EmbedBuilder(embed.toJSON());

		let lyrics = getRandomLyric(gameInfo.allLyrics);

		while (lyrics == gameInfo.currentLyrics) {
			lyrics = getRandomLyric(gameInfo.allLyrics);
		}

		newEmbed.setDescription(embed.description + '\n\n' + lyrics);

		await msg.fetch();
		await msg.channel.fetch();

		msg.edit({
			embeds: [newEmbed]
		});

		interaction.deferUpdate();
	}

	@SelectMenuComponent({ id: /lyric_guess/ })
	async handle(interaction: SelectMenuInteraction) {
		const msg = interaction.message;
		const id = msg.id;

		const gameInfo: {
			song: string;
			allLyrics: string;
			currentLyrics: string;
		} = gameCache.get(`gameInfo-${id}`);

		if (!gameInfo) return;

		const song = interaction.values?.[0];
		let songTitle = new Buffer(song, 'base64').toString('ascii');

		if (songTitle.toLowerCase() == gameInfo.song) {
			await interaction.reply({
				content: `${interaction.user.username} won! The song was ${gameInfo.song}`
			});

			gameCache.del(`gameInfo-${id}`);
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
