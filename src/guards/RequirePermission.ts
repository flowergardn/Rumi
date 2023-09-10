import {
	CommandInteraction,
	EmbedBuilder,
	PermissionResolvable,
	PermissionsBitField,
	StringSelectMenuInteraction,
	inlineCode
} from 'discord.js';
import { GuardFunction } from 'discordx';

const prettify = (s: string, titleCase: boolean = false) => {
	let newString = s.replace(/(_|-)/gi, ' ');
	newString = newString.charAt(0).toUpperCase() + newString.slice(1);
	if (!titleCase) return newString;
	else
		return newString
			.split(' ')
			.map((word) => word[0].toUpperCase() + word.substring(1))
			.join(' ');
};

export function RequirePermission(permission: PermissionResolvable) {
	const guard: GuardFunction<StringSelectMenuInteraction | CommandInteraction> = async (
		interaction,
		// unused client instance
		_,
		next
	) => {
		const permissions = interaction.member.permissions as Readonly<PermissionsBitField>;

		const hasPermission = permissions.has(permission);

		if (hasPermission) return await next();

		const _perm = prettify(permission.toString());

		const noPerrmission = new EmbedBuilder().setColor('Red').setTitle('No permission!');
		noPerrmission.setDescription(`This command requires the ${inlineCode(_perm)} permission`);
		interaction.reply({
			embeds: [noPerrmission],
			ephemeral: true
		});
	};

	return guard;
}
