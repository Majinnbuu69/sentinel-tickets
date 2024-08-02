const {
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  PermissionFlagsBits,
} = require("discord.js");
const fs = require("fs");
const yaml = require("yaml");
const configFile = fs.readFileSync("./config.yml", "utf8");
const config = yaml.parse(configFile);
const { client, ticketsDB } = require("../../init.js");
const {
  configEmbed,
  logMessage,
  sanitizeInput,
  checkSupportRole,
  saveTranscript,
  saveTranscriptTxt,
  getUser,
  getChannel,
} = require("../../utils/mainUtils.js");

module.exports = {
  enabled: config.contextMenuCommands.ticketTranscript.enabled,
  data: new ContextMenuCommandBuilder()
    .setName("Ticket Transcript")
    .setType(ApplicationCommandType.Message)
    .setDefaultMemberPermissions(
      PermissionFlagsBits[
        config.contextMenuCommands.ticketTranscript.permission
      ],
    )
    .setDMPermission(false),
  async execute(interaction) {
    if (!(await ticketsDB.has(interaction.channel.id))) {
      return interaction.reply({
        content:
          config.errors.not_in_a_ticket || "You are not in a ticket channel!",
        ephemeral: true,
      });
    }

    const hasSupportRole = await checkSupportRole(interaction);
    if (!hasSupportRole) {
      return interaction.reply({
        content:
          config.errors.not_allowed || "You are not allowed to use this!",
        ephemeral: true,
      });
    }
    const isEphemeral =
      config.transcriptReplyEmbed.ephemeral !== undefined
        ? config.transcriptReplyEmbed.ephemeral
        : true;
    await interaction.deferReply({ ephemeral: isEphemeral });

    let ticketUserID = await getUser(
      await ticketsDB.get(`${interaction.channel.id}.userID`),
    );

    let attachment;
    const transcriptType = config.transcriptType || "HTML";
    const transcriptImages =
      config.transcriptImages !== undefined ? config.transcriptImages : true;
    if (transcriptType === "HTML") {
      attachment = await saveTranscript(interaction, null, transcriptImages);
    } else if (transcriptType === "TXT") {
      attachment = await saveTranscriptTxt(interaction);
    }

    const logDefaultValues = {
      color: "#2FF200",
      title: "Ticket Transcript",
      description: `Saved by {user}`,
      timestamp: true,
      footer: {
        text: `${ticketUserID.tag}`,
        iconURL: `${ticketUserID.displayAvatarURL({ extension: "png", size: 1024 })}`,
      },
    };

    const transcriptEmbed = await configEmbed(
      "transcriptEmbed",
      logDefaultValues,
    );

    if (transcriptEmbed.data && transcriptEmbed.data.description) {
      transcriptEmbed.setDescription(
        transcriptEmbed.data.description.replace(/\{user\}/g, interaction.user),
      );
    }

    transcriptEmbed.addFields([
      {
        name: config.transcriptEmbed.field_creator || "Ticket Creator",
        value: `<@!${ticketUserID.id}>\n${sanitizeInput(ticketUserID.tag)}`,
        inline: true,
      },
      {
        name: config.transcriptEmbed.field_ticket || "Ticket Name",
        value: `<#${interaction.channel.id}>\n${sanitizeInput(interaction.channel.name)}`,
        inline: true,
      },
      {
        name: config.transcriptEmbed.field_category || "Category",
        value: `${await ticketsDB.get(`${interaction.channel.id}.ticketType`)}`,
        inline: true,
      },
      {
        name: config.transcriptEmbed.field_creation || "Creation Time",
        value: `<t:${await ticketsDB.get(`${interaction.channel.id}.creationTime`)}:F>`,
      },
    ]);

    let logChannelId = config.logs.transcripts || config.logs.default;
    let logChannel = await getChannel(logChannelId);

    const replyDefaultValues = {
      color: "#2FF200",
      title: "Transcript Saved",
      description: `A Transcript has been saved by {user} ({user.tag}) to {channel}`,
      timestamp: true,
      footer: {
        text: `${interaction.user.tag}`,
        iconURL: `${interaction.user.displayAvatarURL({ extension: "png", size: 1024 })}`,
      },
    };

    const transcriptReplyEmbed = await configEmbed(
      "transcriptReplyEmbed",
      replyDefaultValues,
    );

    if (transcriptReplyEmbed.data && transcriptReplyEmbed.data.description) {
      transcriptReplyEmbed.setDescription(
        transcriptReplyEmbed.data.description
          .replace(/\{user\}/g, interaction.user)
          .replace(/\{user\.tag\}/g, sanitizeInput(interaction.user.tag))
          .replace(/\{channel\}/g, `<#${logChannel.id}>`),
      );
    }

    try {
      await logChannel.send({ embeds: [transcriptEmbed], files: [attachment] });
    } catch (error) {
      error.errorContext = `[Logging Error]: please make sure to at least configure your default log channel`;
      client.emit("error", error);
    }
    await interaction.editReply({
      embeds: [transcriptReplyEmbed],
      ephemeral: isEphemeral,
    });
    logMessage(
      `${interaction.user.tag} manually saved the transcript of ticket #${interaction.channel.name} which was created by ${ticketUserID.tag}`,
    );
  },
};
