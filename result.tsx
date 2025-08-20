import React, { useEffect, useState, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  Platform,
  Animated,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { Save, Share2, AlertCircle, Heart, Zap, Shield } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useNutrition } from "@/hooks/nutrition-store";
import { DonutChart } from "@/components/DonutChart";
import { ProgressBar } from "@/components/ProgressBar";
import { NutrientTile } from "@/components/NutrientTile";
import { WEBHOOK_URL, DAILY_VALUES } from "@/constants/nutrition";
import {
  normalizeNutritionData,
  calculateMacroCalories,
  calculateDailyValue,
  calculateHealthScore,
  getMacroPercentages,
  generateId,
} from "@/utils/nutrition";
import type { HistoryEntry, NutritionResult } from "@/types/nutrition";
import * as WebBrowser from "expo-web-browser";

const HEALTH_TIPS = [
  {
    icon: Heart,
    title: "Heart Health",
    description: "Eating nutrient-rich foods helps maintain healthy blood pressure and cholesterol levels."
  },
  {
    icon: Zap,
    title: "Energy Boost",
    description: "Balanced meals with protein, healthy fats, and complex carbs provide sustained energy."
  },
  {
    icon: Shield,
    title: "Immune Support",
    description: "Vitamins and minerals from whole foods strengthen your immune system naturally."
  },
  {
    icon: Heart,
    title: "Mental Clarity",
    description: "Proper nutrition supports brain function and helps improve focus and memory."
  },
  {
    icon: Zap,
    title: "Weight Management",
    description: "Understanding nutrition helps you make informed choices for a healthy weight."
  },
  {
    icon: Shield,
    title: "Disease Prevention",
    description: "A balanced diet rich in antioxidants helps reduce the risk of chronic diseases."
  }
];

export default function ResultScreen() {
  const params = useLocalSearchParams();
  const { history, saveHistory, setCurrentResult } = useNutrition();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HistoryEntry | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [currentTipIndex, setCurrentTipIndex] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (params.id) {
      // Load from history
      const entry = history.find((item) => item.id === params.id);
      if (entry) {
        setResult(entry);
      }
    } else if (params.imageUri) {
      // New scan - only call once
      analyzeImage(params.imageUri as string);
    }
  }, [params.id, params.imageUri]);

  // Health tips rotation effect
  useEffect(() => {
    if (!isLoading) return;

    const interval = setInterval(() => {
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      setCurrentTipIndex((prev) => (prev + 1) % HEALTH_TIPS.length);
    }, 3000);

    return () => clearInterval(interval);
  }, [isLoading, fadeAnim]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const analyzeImage = async (imageUri: string) => {
    // Prevent multiple simultaneous requests
    if (isLoading || abortControllerRef.current) {
      console.log('Request already in progress, skipping...');
      return;
    }

    setIsLoading(true);
    setError(null);
    setHtmlContent(null);
    setCurrentTipIndex(0);

    // Create abort controller for 60-second timeout
    abortControllerRef.current = new AbortController();
    const timeoutId = setTimeout(() => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    }, 60000); // 60 seconds timeout

    try {
      const formData = new FormData();
      
      if (Platform.OS === "web") {
        // For web, fetch the image and create a blob
        const response = await fetch(imageUri);
        const blob = await response.blob();
        formData.append("image", blob, "photo.jpg");
      } else {
        // For mobile
        const uriParts = imageUri.split(".");
        const fileType = uriParts[uriParts.length - 1];
        
        formData.append("image", {
          uri: imageUri,
          name: `photo.${fileType}`,
          type: `image/${fileType}`,
        } as any);
      }

      if (params.notes) {
        formData.append("notes", params.notes as string);
      }

      console.log('Sending request to webhook...');
      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        body: formData,
        signal: abortControllerRef.current.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('text/html')) {
        const html = await response.text();
        setHtmlContent(html);
        setResult(null);
        setCurrentResult(null);
        return;
      }

      const data = await response.json();
      console.log('Received response:', data);
      const normalized = normalizeNutritionData(data);
      
      const entry: HistoryEntry = {
        ...normalized,
        id: generateId(),
        timestamp: Date.now(),
        imageThumb: imageUri,
        notes: params.notes as string,
      };

      setResult(entry);
      setCurrentResult(entry);
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error("Error analyzing image:", err);
      
      if (err.name === 'AbortError') {
        setError("Request timed out after 60 seconds. Please try again with a clearer image.");
      } else {
        setError("Failed to analyze image. Please check your connection and try again.");
      }
    } finally {
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!result || isSaving) return;

    if (Platform.OS !== "web") {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    setIsSaving(true);
    try {
      await saveHistory(result);
      Alert.alert("Success", "Saved to history!");
    } catch (err) {
      Alert.alert("Error", "Failed to save. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleShare = () => {
    if (!result) return;
    
    const text = `Nutrition Info:\n${result.calories_kcal} kcal\nProtein: ${result.protein_g}g\nCarbs: ${result.carbs_g}g\nFat: ${result.fat_g}g`;
    Alert.alert("Share", text);
  };

  if (isLoading) {
    const currentTip = HEALTH_TIPS[currentTipIndex];
    const IconComponent = currentTip.icon;
    
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.loadingContent}>
          <ActivityIndicator size="large" color="#10B981" style={styles.spinner} />
          <Text style={styles.loadingTitle}>Analyzing your meal...</Text>
          <Text style={styles.loadingSubtitle}>This may take up to 60 seconds</Text>
          
          <Animated.View style={[styles.tipCard, { opacity: fadeAnim }]}>
            <View style={styles.tipHeader}>
              <IconComponent size={24} color="#10B981" />
              <Text style={styles.tipTitle}>{currentTip.title}</Text>
            </View>
            <Text style={styles.tipDescription}>{currentTip.description}</Text>
          </Animated.View>
          
          <View style={styles.tipIndicators}>
            {HEALTH_TIPS.map((_, index) => (
              <View
                key={index}
                style={[
                  styles.tipIndicator,
                  index === currentTipIndex && styles.tipIndicatorActive,
                ]}
              />
            ))}
          </View>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <AlertCircle size={48} color="#EF4444" />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => {
            if (params.imageUri) {
              // Reset error state and retry
              setError(null);
              analyzeImage(params.imageUri as string);
            }
          }}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!result && !htmlContent) {
    return null;
  }

  const macros = result ? calculateMacroCalories(result) : { protein: 0, carbs: 0, fat: 0, total: 0 };
  const macroPercentages = getMacroPercentages(macros);
  const healthScore = result ? calculateHealthScore(result) : 0;

  const donutData = [
    { value: macros.protein, color: "#3B82F6", label: "Protein" },
    { value: macros.carbs, color: "#F59E0B", label: "Carbs" },
    { value: macros.fat, color: "#EF4444", label: "Fat" },
  ];

  const isFromHistory = !!params.id;

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerActions}>
              {!isFromHistory && !!result && (
                <TouchableOpacity onPress={handleSave} disabled={isSaving}>
                  <Save size={24} color={isSaving ? "#9CA3AF" : "#10B981"} />
                </TouchableOpacity>
              )}
              {!!result && (
                <TouchableOpacity onPress={handleShare} style={{ marginLeft: 16 }}>
                  <Share2 size={24} color="#6B7280" />
                </TouchableOpacity>
              )}
            </View>
          ),
        }}
      />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false} testID="resultScrollView">
        {htmlContent ? (
          <View style={styles.heroCard} testID="htmlPreviewCard">
            <Text style={styles.sectionTitle}>Analyzer Preview</Text>
            {Platform.OS === 'web' ? (
              <View style={{ height: 400, backgroundColor: '#FFFFFF', borderRadius: 12, overflow: 'hidden' }}>
                {React.createElement('div', { style: { width: '100%', height: '100%', overflow: 'auto' }, dangerouslySetInnerHTML: { __html: htmlContent } })}
              </View>
            ) : (
              <View style={{ padding: 16 }}>
                <Text style={styles.loadingSubtitle}>Preview opens in browser</Text>
                <TouchableOpacity
                  style={styles.retryButton}
                  onPress={async () => {
                    try {
                      const url = `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`;
                      await WebBrowser.openBrowserAsync(url);
                    } catch (e) {
                      Alert.alert('Open Failed', 'Unable to open preview.');
                    }
                  }}
                >
                  <Text style={styles.retryButtonText}>Open Preview</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : (
        <View style={styles.heroCard}>
          {result?.imageThumb && (
            <Image source={{ uri: result.imageThumb }} style={styles.thumbnail} />
          )}
          <View style={styles.heroContent}>
            <View style={styles.caloriesRow}>
              <Text style={styles.caloriesValue}>{result?.calories_kcal}</Text>
              <Text style={styles.caloriesLabel}>kcal</Text>
              <View style={styles.healthScoreBadge}>
                <Text style={styles.healthScoreText}>Score: {healthScore}</Text>
              </View>
            </View>
            <Text style={styles.servings}>Servings: {result?.servings}</Text>
            {!!result?.reasoning && (
              <Text style={styles.reasoning} numberOfLines={3}>
                {result?.reasoning}
              </Text>
            )}
          </View>
        </View>
        )}

        {result && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Macro Distribution</Text>
          <DonutChart
            data={donutData}
            size={200}
            centerValue={`${result.calories_kcal}`}
            centerLabel="kcal"
          />
        </View>
        )}

        {result && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>% Daily Values</Text>
          <View style={styles.progressBars}>
            <ProgressBar
              label="Total Fat"
              value={result.fat_g}
              unit="g"
              percentage={calculateDailyValue(result.fat_g, DAILY_VALUES.fat_g).percentage}
              color={calculateDailyValue(result.fat_g, DAILY_VALUES.fat_g).color}
            />
            <ProgressBar
              label="Saturated Fat"
              value={result.sat_fat_g}
              unit="g"
              percentage={calculateDailyValue(result.sat_fat_g, DAILY_VALUES.sat_fat_g).percentage}
              color={calculateDailyValue(result.sat_fat_g, DAILY_VALUES.sat_fat_g).color}
            />
            <ProgressBar
              label="Cholesterol"
              value={result.cholesterol_mg}
              unit="mg"
              percentage={calculateDailyValue(result.cholesterol_mg, DAILY_VALUES.cholesterol_mg).percentage}
              color={calculateDailyValue(result.cholesterol_mg, DAILY_VALUES.cholesterol_mg).color}
            />
            <ProgressBar
              label="Sodium"
              value={result.sodium_mg}
              unit="mg"
              percentage={calculateDailyValue(result.sodium_mg, DAILY_VALUES.sodium_mg).percentage}
              color={calculateDailyValue(result.sodium_mg, DAILY_VALUES.sodium_mg).color}
            />
            <ProgressBar
              label="Total Carbohydrate"
              value={result.carbs_g}
              unit="g"
              percentage={calculateDailyValue(result.carbs_g, DAILY_VALUES.carbs_g).percentage}
              color={calculateDailyValue(result.carbs_g, DAILY_VALUES.carbs_g).color}
            />
            <ProgressBar
              label="Dietary Fiber"
              value={result.fiber_g}
              unit="g"
              percentage={calculateDailyValue(result.fiber_g, DAILY_VALUES.fiber_g).percentage}
              color={calculateDailyValue(result.fiber_g, DAILY_VALUES.fiber_g).color}
            />
            <ProgressBar
              label="Total Sugars"
              value={result.sugars_g}
              unit="g"
              percentage={calculateDailyValue(result.sugars_g, DAILY_VALUES.sugars_g).percentage}
              color={calculateDailyValue(result.sugars_g, DAILY_VALUES.sugars_g).color}
            />
            {result.added_sugars_g > 0 && (
              <ProgressBar
                label="Added Sugars"
                value={result.added_sugars_g}
                unit="g"
                percentage={calculateDailyValue(result.added_sugars_g, 25).percentage}
                color={calculateDailyValue(result.added_sugars_g, 25).color}
              />
            )}
            <ProgressBar
              label="Protein"
              value={result.protein_g}
              unit="g"
              percentage={calculateDailyValue(result.protein_g, DAILY_VALUES.protein_g).percentage}
              color={calculateDailyValue(result.protein_g, DAILY_VALUES.protein_g).color}
            />
          </View>
        </View>
        )}

        {result && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Key Nutrients</Text>
          <View style={styles.tilesGrid}>
            <NutrientTile label="Protein" value={result.protein_g} unit="g" color="#3B82F6" />
            <NutrientTile label="Carbs" value={result.carbs_g} unit="g" color="#F59E0B" />
            <NutrientTile label="Fat" value={result.fat_g} unit="g" color="#EF4444" />
            <NutrientTile label="Fiber" value={result.fiber_g} unit="g" color="#10B981" />
            <NutrientTile label="Sugars" value={result.sugars_g} unit="g" color="#8B5CF6" />
            <NutrientTile label="Sodium" value={result.sodium_mg} unit="mg" color="#EC4899" />
          </View>
        </View>
        )}

        <Text style={styles.disclaimer}>
          Estimates vary by brand and preparation. Values are approximations.
        </Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F9FAFB",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F9FAFB",
    padding: 24,
  },
  loadingContent: {
    alignItems: "center",
    maxWidth: 320,
  },
  spinner: {
    marginBottom: 24,
  },
  loadingTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#1F2937",
    marginBottom: 8,
    textAlign: "center",
  },
  loadingSubtitle: {
    fontSize: 14,
    color: "#6B7280",
    marginBottom: 32,
    textAlign: "center",
  },
  tipCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 3,
    width: "100%",
  },
  tipHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  tipTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1F2937",
    marginLeft: 12,
  },
  tipDescription: {
    fontSize: 14,
    color: "#6B7280",
    lineHeight: 20,
  },
  tipIndicators: {
    flexDirection: "row",
    gap: 8,
  },
  tipIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#D1D5DB",
  },
  tipIndicatorActive: {
    backgroundColor: "#10B981",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#F9FAFB",
  },
  errorText: {
    fontSize: 16,
    color: "#EF4444",
    textAlign: "center",
    marginTop: 16,
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: "#10B981",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 16,
  },
  heroCard: {
    backgroundColor: "#FFFFFF",
    margin: 16,
    borderRadius: 20,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 3,
  },
  thumbnail: {
    width: "100%",
    height: 200,
    backgroundColor: "#F3F4F6",
  },
  heroContent: {
    padding: 20,
  },
  caloriesRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 8,
  },
  caloriesValue: {
    fontSize: 48,
    fontWeight: "bold",
    color: "#10B981",
  },
  caloriesLabel: {
    fontSize: 20,
    color: "#6B7280",
    marginLeft: 8,
  },
  healthScoreBadge: {
    marginLeft: "auto",
    backgroundColor: "#10B981",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  healthScoreText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  servings: {
    fontSize: 16,
    color: "#6B7280",
    marginBottom: 12,
  },
  reasoning: {
    fontSize: 14,
    color: "#6B7280",
    lineHeight: 20,
  },
  section: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1F2937",
    marginBottom: 16,
  },
  progressBars: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
  },
  tilesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  disclaimer: {
    fontSize: 12,
    color: "#9CA3AF",
    textAlign: "center",
    padding: 20,
    fontStyle: "italic",
  },
});