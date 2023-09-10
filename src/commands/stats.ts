import {
	ApplicationCommandOptionType,
	CommandInteraction,
	EmbedBuilder,
	User,
	bold
} from 'discord.js';
import { Discord, Slash, SlashOption } from 'discordx';
import { prisma } from '..';

@Discord()
class Statistics {
	@Slash({ description: 'View statistics for you or another player' })
	async stats(
		@SlashOption({
			description: 'A member',
			name: 'member',
			required: false,
			type: ApplicationCommandOptionType.User
		})
		member: User,
		interaction: CommandInteraction
	) {
		await interaction.deferReply();

		const user = member ? member : interaction.user;

		let player = await prisma.member.findUnique({
			where: {
				id: user.id
			}
		});

		if (!player) {
			await prisma.member.create({
				data: {
					id: user.id
				}
			});
			player = await prisma.member.findUnique({
				where: {
					id: user.id
				}
			});
		}

		let name = user.username;

		if (user.id == interaction.user.id) name = 'Your';
		else name += 's';

		const embed = new EmbedBuilder().setColor('Green').setTitle(`${name} statistics`);

		embed.setFields([
			{
				name: 'Points',
				value: `${bold(String(player.points))} points`
			},
			{
				name: 'Wins',
				value: `${bold(String(player.wins))} won games`
			}
		]);

		interaction.editReply({
			embeds: [embed]
		});
	}
}
