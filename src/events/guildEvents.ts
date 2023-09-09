import { ArgsOf, Discord, On } from 'discordx';
import { prisma } from '..';

@Discord()
class GuildEvents {
	@On({ event: 'guildCreate' })
	async onGuildJoin([guild]: ArgsOf<'guildCreate'>) {
		await prisma.server.create({
			data: {
				id: guild.id
			}
		});
	}
}
