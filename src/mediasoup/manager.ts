import * as mediasoup from 'mediasoup'
import type { types } from 'mediasoup'
import { config } from './config'

type Worker = types.Worker
type Router = types.Router
type WebRtcTransport = types.WebRtcTransport
type Producer = types.Producer
type Consumer = types.Consumer

export class MediasoupManager {
  private workers: Worker[] = []
  private nextWorkerIdx = 0
  private routers = new Map<string, Router>()
  private transports = new Map<string, WebRtcTransport>()
  private producers = new Map<string, Producer>()
  private consumers = new Map<string, Consumer>()

  async init() {
    const { numWorkers } = config.mediasoup
    
    for (let i = 0; i < numWorkers; i++) {
      const worker = await mediasoup.createWorker({
        logLevel: config.mediasoup.worker.logLevel,
        logTags: [...config.mediasoup.worker.logTags],
        rtcMinPort: config.mediasoup.worker.rtcMinPort,
        rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
      })

      worker.on('died', () => {
        console.error('❌ mediasoup worker died [pid:%d]', worker.pid)
        setTimeout(() => process.exit(1), 2000)
      })

      this.workers.push(worker)
    }

    console.log(`✅ Created ${this.workers.length} mediasoup workers`)
  }

  getWorker(): Worker {
    const worker = this.workers[this.nextWorkerIdx]
    this.nextWorkerIdx = (this.nextWorkerIdx + 1) % this.workers.length
    return worker
  }

  async createRouter(roomId: string): Promise<Router> {
    const worker = this.getWorker()
    const router = await worker.createRouter({
      mediaCodecs: config.mediasoup.router.mediaCodecs,
    })
    
    this.routers.set(roomId, router)
    console.log(`📡 Created router for room: ${roomId}`)
    return router
  }

  getRouter(roomId: string): Router | undefined {
    return this.routers.get(roomId)
  }

  async createWebRtcTransport(router: Router, transportId: string): Promise<WebRtcTransport> {
    const transport = await router.createWebRtcTransport({
      listenIps: config.mediasoup.webRtcTransport.listenIps,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: config.mediasoup.webRtcTransport.initialAvailableOutgoingBitrate,
    })

    this.transports.set(transportId, transport)
    return transport
  }

  getTransport(transportId: string): WebRtcTransport | undefined {
    return this.transports.get(transportId)
  }

  setProducer(producerId: string, producer: Producer) {
    this.producers.set(producerId, producer)
  }

  getProducer(producerId: string): Producer | undefined {
    return this.producers.get(producerId)
  }

  setConsumer(consumerId: string, consumer: Consumer) {
    this.consumers.set(consumerId, consumer)
  }

  getConsumer(consumerId: string): Consumer | undefined {
    return this.consumers.get(consumerId)
  }

  deleteTransport(transportId: string) {
    const transport = this.transports.get(transportId)
    if (transport) {
      transport.close()
      this.transports.delete(transportId)
    }
  }

  deleteProducer(producerId: string) {
    const producer = this.producers.get(producerId)
    if (producer) {
      producer.close()
      this.producers.delete(producerId)
    }
  }

  deleteConsumer(consumerId: string) {
    const consumer = this.consumers.get(consumerId)
    if (consumer) {
      consumer.close()
      this.consumers.delete(consumerId)
    }
  }

  cleanup(roomId: string) {
    const router = this.routers.get(roomId)
    if (router) {
      router.close()
      this.routers.delete(roomId)
      console.log(`🧹 Cleaned up router for room: ${roomId}`)
    }
  }
}

export const mediasoupManager = new MediasoupManager()
