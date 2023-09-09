import { ApplicationCommandOptionType, CommandInteraction, inlineCode } from 'discord.js';
import { Discord, Slash, SlashOption } from 'discordx';
import axios from 'axios';
import { prisma } from '..';

interface LastFMTrack {
	name: string;
}

interface LastFMResponse {
	toptracks: {
		track: LastFMTrack[];
	};
}

@Discord()
class AddArtist {
	@Slash({ description: 'Add an artist to the server' })
	async add(
		@SlashOption({
			description: "What's the name?",
			name: 'artist',
			required: true,
			type: ApplicationCommandOptionType.String
		})
		artist: string,
		interaction: CommandInteraction
	) {
		let artistEntry = await prisma.artist.findUnique({
			where: {
				name: artist
			}
		});

		await interaction.reply({
			content: 'Adding artist...'
		});

		if (!artistEntry) {
			await interaction.editReply({
				content: 'This artist is new to me, please wait whilst I find their songs!'
			});

			const options = {
				method: 'GET',
				url: 'http://ws.audioscrobbler.com/2.0/',
				params: {
					method: 'artist.gettoptracks',
					artist,
					api_key: '8c250ccdcabef2dfd855218787dc2f18',
					format: 'json'
				},
				headers: { 'User-Agent': 'astridlol/Rumi' }
			};

			const req: {
				data: LastFMResponse;
			} = await axios.request(options);

			const songs = req.data.toptracks.track.map((t) => `${artist} - ${t.name}`);

			await prisma.artist.create({
				data: {
					name: artist,
					songs: JSON.stringify(songs)
				}
			});

			artistEntry = await prisma.artist.findUnique({
				where: {
					name: artist
				}
			});

			await interaction.editReply({
				content: `Successfully indexed artist!`
			});
		}

		const server = await prisma.server.findUnique({
			where: {
				id: interaction.guildId
			}
		});

		const _artists: string[] = JSON.parse(server.artists);
		_artists.push(artistEntry.id);

		await prisma.server.update({
			where: {
				id: interaction.guildId
			},
			data: {
				artists: JSON.stringify(_artists)
			}
		});

		await interaction.editReply({
			content: `Added ${inlineCode(artist)} to this server.`
		});
	}
}
