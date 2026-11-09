import { Kafka, logLevel } from "kafkajs";
import { config } from "../config.js";

let producerPromise;

function saslConfiguration() {
  if (!config.kafka.saslMechanism) return undefined;
  return {
    mechanism: config.kafka.saslMechanism,
    username: config.kafka.saslUsername,
    password: config.kafka.saslPassword,
  };
}

async function connectedProducer() {
  if (!producerPromise) {
    producerPromise = (async () => {
      const kafka = new Kafka({
        clientId: config.kafka.clientId,
        brokers: config.kafka.brokers,
        ssl: config.kafka.ssl || undefined,
        sasl: saslConfiguration(),
        logLevel: logLevel.WARN,
      });
      const producer = kafka.producer({ allowAutoTopicCreation: false });
      await producer.connect();
      return producer;
    })().catch((error) => {
      producerPromise = undefined;
      throw error;
    });
  }
  return producerPromise;
}

export async function publishJudgmentUploaded(event) {
  const producer = await connectedProducer();
  await producer.send({
    topic: config.kafka.topic,
    acks: -1,
    messages: [
      {
        key: event.document.documentId,
        value: JSON.stringify(event),
        headers: {
          eventType: event.eventType,
          schemaVersion: event.schemaVersion,
        },
      },
    ],
  });
}

export async function disconnectKafka() {
  if (!producerPromise) return;
  try {
    const producer = await producerPromise;
    await producer.disconnect();
  } finally {
    producerPromise = undefined;
  }
}
