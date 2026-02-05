/**
 * AR Direction Plugin
 * 
 * Bağımsız yön hesaplama ve AR navigasyon plugini.
 * Harita ve rota hesaplama sisteminden bağımsız çalışır.
 * 
 * Input: Line segment dizisi {x1, y1, x2, y2} veya nokta dizisi [[x,y], ...]
 * Output: Pusula yönü ve ok gösterimi için callback'ler
 * 
 * Kullanım:
 * const plugin = new ARDirectionPlugin({
 *     segments: [{x1: 100, y1: 100, x2: 150, y2: 120}, ...],
 *     maxSegments: 5,
 *     onDirectionCalculated: (direction) => {},
 *     onArrowUpdate: (arrowData) => {},
 *     onError: (error) => {}
 * });
 * plugin.start();
 */

class ARDirectionPlugin {
    constructor(options = {}) {
        // Segment verileri
        this.segments = options.segments || [];
        this.maxSegments = options.maxSegments || 5;
        
        // Callbacks
        this.onDirectionCalculated = options.onDirectionCalculated || (() => {});
        this.onArrowUpdate = options.onArrowUpdate || (() => {});
        this.onError = options.onError || ((e) => console.error(e));
        
        // State
        this.isRunning = false;
        this.compassListener = null;
        this.compassListenerWebkit = null;
        this.currentDirection = null;
        
        // Hesaplanan yön
        this.calculatedAngle = 0;
        this.calculatedCompass = '';
    }

    /**
     * Line segment formatından nokta dizisine çevirir
     * Input: [{x1, y1, x2, y2}, ...]
     * Output: [[x, y], ...]
     */
    static segmentsToPoints(segments) {
        if (!segments || segments.length === 0) return [];
        
        const points = [];
        
        // İlk noktayı ekle
        points.push([segments[0].x1, segments[0].y1]);
        
        // Her segmentin bitiş noktasını ekle
        for (const seg of segments) {
            points.push([seg.x2, seg.y2]);
        }
        
        return points;
    }

    /**
     * Nokta dizisinden line segment formatına çevirir
     * Input: [[x, y], ...]
     * Output: [{x1, y1, x2, y2}, ...]
     */
    static pointsToSegments(points) {
        if (!points || points.length < 2) return [];
        
        const segments = [];
        
        for (let i = 0; i < points.length - 1; i++) {
            segments.push({
                x1: points[i][0],
                y1: points[i][1],
                x2: points[i + 1][0],
                y2: points[i + 1][1]
            });
        }
        
        return segments;
    }

    /**
     * Segment verisi ayarlar
     */
    setSegments(segments, maxSegments = null) {
        this.segments = segments || [];
        if (maxSegments !== null) {
            this.maxSegments = maxSegments;
        }
    }

    /**
     * Nokta dizisi ile segment ayarlar (converter ile)
     */
    setPathFromPoints(points, maxSegments = null) {
        this.segments = ARDirectionPlugin.pointsToSegments(points);
        if (maxSegments !== null) {
            this.maxSegments = maxSegments;
        }
    }

    /**
     * Yönü hesaplar (maxSegments kadar segment kullanır)
     */
    calculateDirection() {
        try {
            if (!this.segments || this.segments.length === 0) {
                throw new Error('Segment verisi yok');
            }

            // Kullanılacak segment sayısı
            const segmentsToUse = this.segments.slice(0, this.maxSegments);
            
            // İlk ve son noktayı al
            const startPoint = [segmentsToUse[0].x1, segmentsToUse[0].y1];
            const lastSegment = segmentsToUse[segmentsToUse.length - 1];
            const endPoint = [lastSegment.x2, lastSegment.y2];

            // Yön vektörü
            const dx = endPoint[0] - startPoint[0];
            const dy = endPoint[1] - startPoint[1];

            // Radyan cinsinden açı (SVG koordinat sisteminde Y aşağı)
            // Math.atan2 kullanarak -π ile π arası açı alıyoruz
            const angleRad = Math.atan2(dx, -dy); // -dy çünkü SVG'de Y aşağı doğru artar
            
            // Dereceye çevir (0-360)
            let angleDeg = (angleRad * 180 / Math.PI + 360) % 360;

            // Pusula yönü
            const compass = this.angleToCompass(angleDeg);

            this.calculatedAngle = angleDeg;
            this.calculatedCompass = compass;

            const result = {
                compassAngle: angleDeg,
                compass: compass,
                startPoint: startPoint,
                endPoint: endPoint,
                dx: dx,
                dy: dy,
                segmentsUsed: segmentsToUse.length
            };

            this.currentDirection = result;
            this.onDirectionCalculated(result);

            return result;

        } catch (e) {
            this.onError(e.message);
            return null;
        }
    }

    /**
     * Açıyı pusula yönüne çevirir
     */
    angleToCompass(angle) {
        const directions = [
            'Kuzey', 'Kuzey-Kuzeydoğu', 'Kuzeydoğu', 'Doğu-Kuzeydoğu',
            'Doğu', 'Doğu-Güneydoğu', 'Güneydoğu', 'Güney-Güneydoğu',
            'Güney', 'Güney-Güneybatı', 'Güneybatı', 'Batı-Güneybatı',
            'Batı', 'Batı-Kuzeybatı', 'Kuzeybatı', 'Kuzey-Kuzeybatı'
        ];
        
        const index = Math.round(angle / 22.5) % 16;
        return directions[index];
    }

    /**
     * Compass listener'ı başlatır
     */
    start() {
        if (this.isRunning) return;
        
        if (!window.DeviceOrientationEvent) {
            this.onError('DeviceOrientation API desteklenmiyor');
            return;
        }

        this.isRunning = true;

        // iOS için izin kontrolü
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission()
                .then(response => {
                    if (response === 'granted') {
                        this.addCompassListeners();
                    } else {
                        this.onError('Cihaz yönü izni reddedildi');
                    }
                })
                .catch(e => {
                    this.onError('İzin hatası: ' + e.message);
                });
        } else {
            this.addCompassListeners();
        }
    }

    /**
     * Compass event listener'larını ekler
     */
    addCompassListeners() {
        // Absolute compass (Android)
        this.compassListener = (event) => {
            if (event.absolute && event.alpha !== null) {
                const compass = 360 - event.alpha;
                this.handleCompassUpdate(compass, event.beta || 90);
            }
        };

        // Webkit compass (iOS)
        this.compassListenerWebkit = (event) => {
            if (event.webkitCompassHeading !== undefined) {
                const compass = event.webkitCompassHeading;
                this.handleCompassUpdate(compass, event.beta || 90);
            }
        };

        window.addEventListener('deviceorientationabsolute', this.compassListener, true);
        window.addEventListener('deviceorientation', this.compassListenerWebkit, true);
    }

    /**
     * Pusula güncellemesini işler
     */
    handleCompassUpdate(compassHeading, beta) {
        if (!this.isRunning) return;

        const arrowData = {
            currentCompass: compassHeading,
            targetCompass: this.calculatedAngle,
            beta: beta,
            isAligned: this.checkAlignment(compassHeading)
        };

        this.onArrowUpdate(arrowData);
    }

    /**
     * Yön hizalamasını kontrol eder
     */
    checkAlignment(currentCompass, tolerance = 20) {
        const target = this.calculatedAngle;
        const upperBound = (target + tolerance) % 360;
        const lowerBound = (target - tolerance + 360) % 360;

        if (lowerBound > upperBound) {
            return currentCompass >= lowerBound || currentCompass <= upperBound;
        }
        return currentCompass >= lowerBound && currentCompass <= upperBound;
    }

    /**
     * Durdurur ve temizler
     */
    stop() {
        this.isRunning = false;

        if (this.compassListener) {
            window.removeEventListener('deviceorientationabsolute', this.compassListener, true);
            this.compassListener = null;
        }

        if (this.compassListenerWebkit) {
            window.removeEventListener('deviceorientation', this.compassListenerWebkit, true);
            this.compassListenerWebkit = null;
        }
    }

    /**
     * Debug için mevcut durumu döndürür
     */
    getState() {
        return {
            isRunning: this.isRunning,
            segmentCount: this.segments.length,
            maxSegments: this.maxSegments,
            calculatedAngle: this.calculatedAngle,
            calculatedCompass: this.calculatedCompass,
            currentDirection: this.currentDirection
        };
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ARDirectionPlugin;
}
